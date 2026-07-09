"use client";

import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { supabase, isConfigured } from "@/lib/supabase";
import { inr, parseISODate, todayMidnight, addCalendarDays, daysBetween, toISODate } from "@/lib/format";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { DataTable, type Column } from "@/components/DataTable";
import { FormField, inputClass } from "@/components/FormField";
import { BarChart, type BarChartDatum } from "@/components/BarChart";
import { ExportButton } from "@/components/ExportButton";

/*
  Cashflow Projection: buckets outstanding-but-unpaid invoices by their expected
  collection date (due_date, unless the analyst overrides it, or "Smart" mode
  predicts it) into weekly or monthly periods, so the team can see cash coming
  in rather than just what's overdue. Overdue invoices are folded into the
  first ("this week / overdue") period so nothing falls off the projection.

  Smart prediction: real customers don't always pay on the due date, so
  "Smart (payment history)" mode looks at each customer's already-paid
  invoices, works out how many days late they typically pay (paid date minus
  due date, floored at 0), and uses that as the default expected date instead
  of the raw due date. Customers with no payment history yet fall back to the
  portfolio-wide average delay. This is standard cash-forecasting practice —
  DSO-style, per-customer payment behaviour beats assuming everyone pays on time.

  Manual overrides (a promised amount/date that differs from both the invoice
  and the prediction) are kept as client-side state only for this pass —
  there's no notes/JSON column on `invoices` to persist them into without
  altering the schema, which the house rules forbid. Refreshing the page
  resets them.
*/

type Mode = "week" | "month";
type PredictionMode = "due" | "smart";
type Basis = "manual" | "predicted" | "due";

interface ProjRow {
  id: string;
  invoice_no: string;
  customer_id: string;
  customerName: string;
  due_date: string; // YYYY-MM-DD
  outstanding: number;
}

interface Override {
  amount?: number;
  date?: string;
}

interface Period {
  key: string;
  label: string;
  chartLabel: string;
  end: Date | null; // exclusive upper bound; null = catch-all overflow bucket
}

function fmtShort(d: Date): string {
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function buildPeriods(mode: Mode, today: Date): Period[] {
  const periods: Period[] = [];
  if (mode === "week") {
    for (let i = 0; i < 12; i++) {
      const end = addCalendarDays(today, 7 * (i + 1));
      periods.push({
        key: `w${i}`,
        label: i === 0 ? "This week / Overdue" : `${fmtShort(addCalendarDays(today, 7 * i))} – ${fmtShort(addCalendarDays(end, -1))}`,
        chartLabel: i === 0 ? "Now" : fmtShort(addCalendarDays(today, 7 * i)),
        end,
      });
    }
  } else {
    const y = today.getFullYear();
    const m = today.getMonth();
    for (let i = 0; i < 6; i++) {
      const end = new Date(y, m + i + 1, 1);
      const label =
        i === 0 ? "This month / Overdue" : new Date(y, m + i, 1).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
      periods.push({ key: `m${i}`, label, chartLabel: label, end });
    }
  }
  periods.push({ key: "beyond", label: "Beyond horizon", chartLabel: "Later", end: null });
  return periods;
}

export default function CashflowPage() {
  const [rows, setRows] = useState<ProjRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const [mode, setMode] = useState<Mode>("week");
  const [predictionMode, setPredictionMode] = useState<PredictionMode>("due");
  const [customerFilter, setCustomerFilter] = useState("all");
  const [minAmount, setMinAmount] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [avgDelayByCustomer, setAvgDelayByCustomer] = useState<Record<string, number>>({});
  const [portfolioAvgDelay, setPortfolioAvgDelay] = useState(0);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);

      const { data: invoices, error: invErr } = await supabase
        .from("invoices")
        .select("id, invoice_no, customer_id, due_date, total, status, customers(name)")
        .in("status", ["open", "partial", "overdue"]);

      if (invErr) {
        if (!cancelled) {
          setError(invErr.message);
          setLoading(false);
        }
        return;
      }

      const ids = (invoices ?? []).map((i) => i.id);
      const allocByInvoice: Record<string, number> = {};
      if (ids.length > 0) {
        const { data: allocs, error: allocErr } = await supabase
          .from("receipt_allocations")
          .select("invoice_id, amount")
          .in("invoice_id", ids);
        if (allocErr) {
          if (!cancelled) {
            setError(allocErr.message);
            setLoading(false);
          }
          return;
        }
        for (const a of allocs ?? []) {
          allocByInvoice[a.invoice_id] = (allocByInvoice[a.invoice_id] ?? 0) + Number(a.amount);
        }
      }

      const built: ProjRow[] = (invoices ?? [])
        .map((i) => {
          const customer = Array.isArray(i.customers) ? i.customers[0] : i.customers;
          return {
            id: i.id,
            invoice_no: i.invoice_no,
            customer_id: i.customer_id,
            customerName: customer?.name ?? "—",
            due_date: i.due_date,
            outstanding: Number(i.total) - (allocByInvoice[i.id] ?? 0),
          };
        })
        .filter((r) => r.outstanding > 0.005);

      if (!cancelled) {
        setRows(built);
        setLoading(false);
      }

      // Best-effort: learn each customer's typical payment delay from invoices
      // already paid, to power "Smart" prediction. Non-fatal if it fails.
      try {
        const { data: paidInvoices } = await supabase.from("invoices").select("id, customer_id, due_date").eq("status", "paid");
        if (paidInvoices && paidInvoices.length > 0) {
          const paidIds = paidInvoices.map((i) => i.id);
          const { data: paidAllocs } = await supabase
            .from("receipt_allocations")
            .select("invoice_id, receipt_id")
            .in("invoice_id", paidIds);
          const receiptIds = Array.from(new Set((paidAllocs ?? []).map((a) => a.receipt_id)));
          const { data: receiptRows } =
            receiptIds.length > 0
              ? await supabase.from("receipts").select("id, receipt_date").in("id", receiptIds)
              : { data: [] as { id: string; receipt_date: string }[] };
          const receiptDateById = new Map((receiptRows ?? []).map((r) => [r.id, r.receipt_date]));

          const paidOnByInvoice = new Map<string, string>();
          for (const a of paidAllocs ?? []) {
            const rd = receiptDateById.get(a.receipt_id);
            if (!rd) continue;
            const existing = paidOnByInvoice.get(a.invoice_id);
            if (!existing || rd > existing) paidOnByInvoice.set(a.invoice_id, rd);
          }

          const delaysByCustomer = new Map<string, number[]>();
          const allDelays: number[] = [];
          for (const inv of paidInvoices) {
            const paidOn = paidOnByInvoice.get(inv.id);
            if (!paidOn) continue;
            const delay = Math.max(0, daysBetween(parseISODate(inv.due_date), parseISODate(paidOn)));
            allDelays.push(delay);
            const list = delaysByCustomer.get(inv.customer_id) ?? [];
            list.push(delay);
            delaysByCustomer.set(inv.customer_id, list);
          }

          const avgMap: Record<string, number> = {};
          delaysByCustomer.forEach((list, custId) => {
            avgMap[custId] = list.reduce((s, d) => s + d, 0) / list.length;
          });

          if (!cancelled) {
            setAvgDelayByCustomer(avgMap);
            setPortfolioAvgDelay(allDelays.length > 0 ? allDelays.reduce((s, d) => s + d, 0) / allDelays.length : 0);
          }
        }
      } catch {
        // Smart prediction is a bonus feature — silently fall back to due dates.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const today = useMemo(() => todayMidnight(), []);

  const customers = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows) map.set(r.customer_id, r.customerName);
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  const filteredRows = useMemo(() => {
    const min = minAmount === "" ? 0 : Number(minAmount);
    return rows.filter((r) => {
      if (customerFilter !== "all" && r.customer_id !== customerFilter) return false;
      if (r.outstanding < min) return false;
      return true;
    });
  }, [rows, customerFilter, minAmount]);

  const effective = useMemo(
    () =>
      filteredRows.map((r) => {
        const o = overrides[r.id];
        let effDate: string;
        let basis: Basis;
        if (o?.date) {
          effDate = o.date;
          basis = "manual";
        } else if (predictionMode === "smart") {
          const delay = avgDelayByCustomer[r.customer_id] ?? portfolioAvgDelay;
          const predicted = addCalendarDays(parseISODate(r.due_date), Math.round(delay));
          effDate = toISODate(predicted < today ? today : predicted);
          basis = "predicted";
        } else {
          effDate = r.due_date;
          basis = "due";
        }
        return {
          ...r,
          effAmount: o?.amount ?? r.outstanding,
          effDate,
          overridden: Boolean(o),
          basis,
        };
      }),
    [filteredRows, overrides, predictionMode, avgDelayByCustomer, portfolioAvgDelay, today]
  );

  const periods = useMemo(() => buildPeriods(mode, today), [mode, today]);

  const bucketed = useMemo(() => {
    const map = new Map<string, { total: number; invoices: typeof effective }>();
    for (const p of periods) map.set(p.key, { total: 0, invoices: [] });
    for (const inv of effective) {
      const d = parseISODate(inv.effDate);
      const period = periods.find((p) => p.end === null || d < p.end) ?? periods[periods.length - 1];
      const bucket = map.get(period.key)!;
      bucket.total += inv.effAmount;
      bucket.invoices.push(inv);
    }
    let cumulative = 0;
    return periods.map((p) => {
      const b = map.get(p.key)!;
      cumulative += b.total;
      return { id: p.key, ...p, count: b.invoices.length, total: b.total, cumulative, invoices: b.invoices };
    });
  }, [effective, periods]);

  const visibleRows = bucketed.filter((p) => p.key !== "beyond" || p.count > 0);

  const totalOutstanding = filteredRows.reduce((s, r) => s + r.outstanding, 0);
  const in30 = addCalendarDays(today, 30);
  const in90 = addCalendarDays(today, 90);
  const totalNext30 = effective.filter((e) => parseISODate(e.effDate) < in30).reduce((s, e) => s + e.effAmount, 0);
  const totalBeyond90 = effective.filter((e) => parseISODate(e.effDate) >= in90).reduce((s, e) => s + e.effAmount, 0);

  function updateOverride(id: string, patch: Override) {
    setOverrides((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }
  function resetOverride(id: string) {
    setOverrides((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  const chartData: BarChartDatum[] = visibleRows.map((p) => {
    let overdueValue = 0;
    let overdueCount = 0;
    let onTimeValue = 0;
    let onTimeCount = 0;
    for (const inv of p.invoices) {
      if (parseISODate(inv.due_date) < today) {
        overdueValue += inv.effAmount;
        overdueCount += 1;
      } else {
        onTimeValue += inv.effAmount;
        onTimeCount += 1;
      }
    }
    return { key: p.key, label: p.label, overdueValue, overdueCount, onTimeValue, onTimeCount, cumulative: p.cumulative };
  });

  function handleExport() {
    const basisLabel: Record<Basis, string> = { manual: "Manual", predicted: "Predicted", due: "Due date" };
    const invoiceRows = visibleRows.flatMap((p) =>
      p.invoices.map((inv) => [
        inv.invoice_no,
        inv.customerName,
        p.label,
        inv.due_date,
        inv.effDate,
        Number(inv.effAmount.toFixed(2)),
        basisLabel[inv.basis],
      ])
    );
    const invoiceSheet = XLSX.utils.aoa_to_sheet([
      ["Invoice #", "Customer", "Period", "Due Date", "Expected Date", "Expected Amount", "Basis"],
      ...invoiceRows,
    ]);

    // Second sheet: one row per period — period, invoice_count, expected_inflow, cumulative_inflow.
    const periodRows = visibleRows.map((p) => [p.label, p.count, Number(p.total.toFixed(2)), Number(p.cumulative.toFixed(2))]);
    const periodSheet = XLSX.utils.aoa_to_sheet([["Period", "Invoice Count", "Expected Inflow", "Cumulative Inflow"], ...periodRows]);

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, invoiceSheet, "Invoices");
    XLSX.utils.book_append_sheet(workbook, periodSheet, "Periods");
    XLSX.writeFile(workbook, `cashflow-projection-${toISODate(today)}.xlsx`);
  }

  const periodColumns: Column<(typeof visibleRows)[number]>[] = [
    { key: "label", header: "Period" },
    { key: "count", header: "# Invoices", className: "text-right" },
    { key: "total", header: "Expected Inflow", className: "text-right", render: (r) => inr.format(r.total) },
    { key: "cumulative", header: "Cumulative Inflow", className: "text-right font-semibold", render: (r) => inr.format(r.cumulative) },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (r) => (
        <button
          onClick={() => setExpanded(expanded === r.key ? null : r.key)}
          className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:border-brand hover:text-brand dark:border-slate-700 dark:text-slate-300 dark:hover:border-brand-400 dark:hover:text-brand-300"
        >
          {expanded === r.key ? "Hide" : "View"}
        </button>
      ),
    },
  ];

  const expandedRow = visibleRows.find((p) => p.key === expanded);

  const invoiceColumns: Column<(typeof effective)[number]>[] = [
    { key: "invoice_no", header: "Invoice #" },
    { key: "customerName", header: "Customer" },
    {
      key: "effAmount",
      header: "Expected Amount",
      render: (r) => (
        <input
          type="number"
          step="0.01"
          min="0"
          className={`${inputClass} w-32`}
          value={r.effAmount}
          onChange={(e) => updateOverride(r.id, { amount: e.target.value === "" ? 0 : Number(e.target.value) })}
        />
      ),
    },
    {
      key: "effDate",
      header: "Expected Date",
      render: (r) => (
        <input
          type="date"
          className={`${inputClass} w-40`}
          value={r.effDate}
          onChange={(e) => updateOverride(r.id, { date: e.target.value })}
        />
      ),
    },
    {
      key: "basis",
      header: "Basis",
      render: (r) => {
        if (r.basis === "manual") {
          return <span className="text-xs font-medium text-brand dark:text-brand-300">Manual</span>;
        }
        if (r.basis === "predicted") {
          const delay = Math.round(avgDelayByCustomer[r.customer_id] ?? portfolioAvgDelay);
          return (
            <span
              className="inline-flex items-center rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent"
              title={`Predicted from this customer's payment history (avg ${delay}d late). Falls back to the portfolio average when a customer has no payment history yet.`}
            >
              Predicted +{delay}d
            </span>
          );
        }
        return <span className="text-xs text-slate-400 dark:text-slate-500">Due date</span>;
      },
    },
    {
      key: "reset",
      header: "",
      render: (r) =>
        r.overridden ? (
          <button onClick={() => resetOverride(r.id)} className="text-xs font-medium text-brand hover:underline dark:text-brand-300">
            Reset
          </button>
        ) : null,
    },
  ];

  if (!isConfigured) {
    return (
      <div className="mx-auto max-w-6xl">
        <PageHeader title="Cashflow Projection" subtitle="Expected collections, week by week." />
        <NotConfigured />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Cashflow Projection"
        subtitle="Expected collections from open invoices — adjust per invoice as customers confirm plans."
        action={
          <div className="flex flex-wrap items-center gap-2">
            {!loading && rows.length > 0 && <ExportButton onClick={handleExport} />}
            <div className="flex rounded-lg border border-slate-300 p-0.5 dark:border-slate-700">
              <button
                onClick={() => setMode("week")}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  mode === "week" ? "bg-brand text-white" : "text-slate-600 dark:text-slate-300"
                }`}
              >
                Weekly (12 wks)
              </button>
              <button
                onClick={() => setMode("month")}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  mode === "month" ? "bg-brand text-white" : "text-slate-600 dark:text-slate-300"
                }`}
              >
                Monthly (6 mo)
              </button>
            </div>
          </div>
        }
      />

      {error && (
        <div className="mb-4 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-950/40 dark:text-red-300">
          Couldn&apos;t load the projection: {error}
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Prediction basis</p>
            <p className="mt-0.5 max-w-xl text-xs text-slate-500 dark:text-slate-400">
              {predictionMode === "smart"
                ? `Smart mode moves each invoice's expected date using that customer's own payment history (portfolio average: ${Math.round(
                    portfolioAvgDelay
                  )} day${Math.round(portfolioAvgDelay) === 1 ? "" : "s"} late). Manual overrides below always win.`
                : "Using each invoice's due date as-is. Switch to Smart to forecast using customers' real payment behaviour instead."}
            </p>
          </div>
          <div className="flex flex-none rounded-lg border border-slate-300 p-0.5 dark:border-slate-700">
            <button
              onClick={() => setPredictionMode("due")}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                predictionMode === "due" ? "bg-brand text-white" : "text-slate-600 dark:text-slate-300"
              }`}
            >
              Due date
            </button>
            <button
              onClick={() => setPredictionMode("smart")}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                predictionMode === "smart" ? "bg-brand text-white" : "text-slate-600 dark:text-slate-300"
              }`}
            >
              Smart (payment history)
            </button>
          </div>
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <FormField label="Customer">
            <select className={inputClass} value={customerFilter} onChange={(e) => setCustomerFilter(e.target.value)}>
              <option value="all">All customers</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </FormField>
          <FormField label="Min. outstanding (₹)">
            <input type="number" min="0" className={inputClass} placeholder="0" value={minAmount} onChange={(e) => setMinAmount(e.target.value)} />
          </FormField>
        </div>
      )}

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-0 sm:divide-x sm:divide-slate-200 dark:divide-slate-800">
        <SummaryTile label="Total Outstanding" value={inr.format(totalOutstanding)} />
        <SummaryTile label="Expected in next 30 days" value={inr.format(totalNext30)} />
        <SummaryTile label="Expected beyond 90 days" value={inr.format(totalBeyond90)} />
      </div>

      {loading ? (
        <div className="p-10 text-center text-slate-400 dark:text-slate-500">
          Loading projection…
        </div>
      ) : rows.length === 0 ? (
        <div className="p-10 text-center text-slate-400 dark:text-slate-500">
          No open, partial, or overdue invoices to project.
        </div>
      ) : filteredRows.length === 0 ? (
        <div className="p-10 text-center text-slate-400 dark:text-slate-500">
          No invoices match these filters.
        </div>
      ) : (
        <>
          <div className="mb-6 border-t border-slate-200 pt-6 dark:border-slate-800">
            <BarChart data={chartData} />
          </div>

          <DataTable columns={periodColumns} rows={visibleRows} />

          {expandedRow && (
            <div className="mt-4">
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Invoices in &ldquo;{expandedRow.label}&rdquo;
              </h3>
              <DataTable columns={invoiceColumns} rows={expandedRow.invoices} empty="No invoices in this period." />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="sm:px-6 sm:first:pl-0">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-brand dark:text-white">{value}</p>
    </div>
  );
}
