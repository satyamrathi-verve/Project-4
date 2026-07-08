"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase, isConfigured } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { DataTable, type Column } from "@/components/DataTable";
import { inputClass } from "@/components/FormField";
import { BarChart, type BarChartDatum } from "@/components/BarChart";

/*
  Cashflow Projection: buckets outstanding-but-unpaid invoices by their expected
  collection date (due_date, unless the analyst overrides it) into weekly or
  monthly periods, so the team can see cash coming in rather than just what's
  overdue. Overdue invoices are folded into the first ("this week / overdue")
  period so nothing falls off the projection.

  Overrides (a promised amount/date that differs from the invoice) are kept as
  client-side state only for this pass — there's no notes/JSON column on
  `invoices` to persist them into without altering the schema, which the
  house rules forbid. Refreshing the page resets them to the invoice's real
  due_date/outstanding.
*/

type Mode = "week" | "month";

interface ProjRow {
  id: string;
  invoice_no: string;
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

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

function parseISODate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}
function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}
function fmtShort(d: Date): string {
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function buildPeriods(mode: Mode, today: Date): Period[] {
  const periods: Period[] = [];
  if (mode === "week") {
    for (let i = 0; i < 12; i++) {
      const end = addDays(today, 7 * (i + 1));
      periods.push({
        key: `w${i}`,
        label: i === 0 ? "This week / Overdue" : `${fmtShort(addDays(today, 7 * i))} – ${fmtShort(addDays(end, -1))}`,
        chartLabel: i === 0 ? "Now" : fmtShort(addDays(today, 7 * i)),
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
  const [expanded, setExpanded] = useState<string | null>(null);

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
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const today = useMemo(() => startOfDay(new Date()), []);

  const effective = useMemo(
    () =>
      rows.map((r) => {
        const o = overrides[r.id];
        return {
          ...r,
          effAmount: o?.amount ?? r.outstanding,
          effDate: o?.date ?? r.due_date,
          overridden: Boolean(o),
        };
      }),
    [rows, overrides]
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

  const totalOutstanding = rows.reduce((s, r) => s + r.outstanding, 0);
  const in30 = addDays(today, 30);
  const in90 = addDays(today, 90);
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

  const chartData: BarChartDatum[] = visibleRows.map((p) => ({ key: p.key, label: p.chartLabel, value: p.total, cumulative: p.cumulative }));

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
        }
      />

      {error && (
        <div className="mb-4 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-950/40 dark:text-red-300">
          Couldn&apos;t load the projection: {error}
        </div>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <SummaryTile label="Total Outstanding" value={inr.format(totalOutstanding)} />
        <SummaryTile label="Expected in next 30 days" value={inr.format(totalNext30)} />
        <SummaryTile label="Expected beyond 90 days" value={inr.format(totalBeyond90)} />
      </div>

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-slate-400 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-500">
          Loading projection…
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-slate-400 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-500">
          No open, partial, or overdue invoices to project.
        </div>
      ) : (
        <>
          <div className="mb-6">
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
    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-brand dark:text-white">{value}</p>
    </div>
  );
}
