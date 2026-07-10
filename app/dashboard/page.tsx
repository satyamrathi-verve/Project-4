"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase, isConfigured } from "@/lib/supabase";
import { inr, inrCompact, parseISODate, todayMidnight, addCalendarDays, formatShortDate, toISODate } from "@/lib/format";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { ScreenIcon } from "@/components/icons";
import { LineChart, CHART_COLORS } from "@/components/LineChart";
import { DonutChart } from "@/components/DonutChart";
import { IconButton, ActionIcons } from "@/components/IconButton";
import { CountUp } from "@/components/CountUp";
import { Reveal } from "@/components/Reveal";
import { effectiveStatus, daysOverdue, type EffectiveStatus } from "@/components/StatusPill";
import type { InvoiceStatus } from "@/lib/types";

/*
  Dashboard: the decision-making overview — KPIs, trends, and drill-down reports.
  Every number (outstanding, overdue, status) uses the same rules as the Ageing
  report and Cashflow Projection so they always agree.

  Reports on this screen, most actionable first:
  - KPI row + DSO banner (AR health at a glance)
  - Overdue by customer (donut of overdue share + the chase-list table)
  - Invoice status breakdown (donut)
  - Top 5 debtors (outstanding curve, with credit-limit breach flags)
  - Sales by customer (donut of revenue share, top 8)
  - Trend charts: sales vs collections, customer sales trend, total debtors, cashflow outlook
*/

interface CustomerLite {
  id: string;
  name: string;
  credit_limit: number;
}

interface InvoiceRow {
  id: string;
  invoice_no: string;
  invoice_date: string;
  customer_id: string;
  customerName: string;
  due_date: string;
  total: number;
  status: InvoiceStatus;
  outstanding: number;
}

interface ReceiptLite {
  id: string;
  receipt_date: string;
  amount: number;
}

interface OverdueByCustomerRow {
  id: string;
  name: string;
  invoices: number;
  amount: number;
  maxDays: number;
}

const STATUS_ORDER: EffectiveStatus[] = ["overdue", "partial", "open", "paid"];
const STATUS_LABEL: Record<EffectiveStatus, string> = { overdue: "Overdue", partial: "Partial", open: "Open", paid: "Paid" };
const STATUS_BAR: Record<EffectiveStatus, string> = {
  overdue: "bg-red-500",
  partial: "bg-amber-500",
  open: "bg-slate-400 dark:bg-slate-500",
  paid: "bg-emerald-500",
};
const DONUT_COLOR: Record<EffectiveStatus, string> = {
  overdue: "text-red-500",
  partial: "text-amber-500",
  open: "text-slate-400 dark:text-slate-500",
  paid: "text-emerald-500",
};

/* Per-customer donut palettes (text-* utilities → stroke via currentColor, so both themes work). */
const CUSTOMER_DONUT_COLORS = [
  "text-sky-500",
  "text-violet-500",
  "text-emerald-500",
  "text-amber-500",
  "text-rose-500",
  "text-teal-500",
  "text-indigo-500",
  "text-fuchsia-500",
];
const OVERDUE_DONUT_COLORS = ["text-red-500", "text-orange-500", "text-amber-500", "text-rose-500", "text-red-400", "text-orange-400"];

/* Keep customer names readable as chart axis labels. */
const shortName = (n: string) => (n.length > 12 ? `${n.slice(0, 11)}…` : n);

export default function DashboardPage() {
  const [customers, setCustomers] = useState<CustomerLite[] | null>(null);
  const [invoices, setInvoices] = useState<InvoiceRow[] | null>(null);
  const [receipts, setReceipts] = useState<ReceiptLite[] | null>(null);
  const [allocations, setAllocations] = useState<{ invoice_id: string; receipt_id: string; amount: number }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const [
        { data: custData, error: custErr },
        { data: invData, error: invErr },
        { data: allocData, error: allocErr },
        { data: rcptData, error: rcptErr },
      ] = await Promise.all([
        supabase.from("customers").select("id, name, credit_limit"),
        supabase.from("invoices").select("id, invoice_no, invoice_date, customer_id, due_date, total, status, customers(name)"),
        supabase.from("receipt_allocations").select("invoice_id, receipt_id, amount"),
        supabase.from("receipts").select("id, receipt_date, amount"),
      ]);

      if (custErr || invErr || allocErr || rcptErr) {
        if (!cancelled) setError(custErr?.message || invErr?.message || allocErr?.message || rcptErr?.message || "Failed to load dashboard.");
        return;
      }

      const allocByInvoice: Record<string, number> = {};
      for (const a of allocData ?? []) {
        allocByInvoice[a.invoice_id] = (allocByInvoice[a.invoice_id] ?? 0) + Number(a.amount);
      }

      const builtInvoices: InvoiceRow[] = (invData ?? []).map((i) => {
        const customer = Array.isArray(i.customers) ? i.customers[0] : i.customers;
        return {
          id: i.id,
          invoice_no: i.invoice_no,
          invoice_date: i.invoice_date,
          customer_id: i.customer_id,
          customerName: customer?.name ?? "—",
          due_date: i.due_date,
          total: Number(i.total),
          status: i.status,
          outstanding: Number(i.total) - (allocByInvoice[i.id] ?? 0),
        };
      });

      if (!cancelled) {
        setCustomers(custData ?? []);
        setInvoices(builtInvoices);
        setAllocations((allocData ?? []).map((a) => ({ ...a, amount: Number(a.amount) })));
        setReceipts((rcptData ?? []).map((r) => ({ ...r, amount: Number(r.amount) })));
        setLoadedAt(new Date());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const loading = customers === null || invoices === null || receipts === null || allocations === null;

  const stats = useMemo(() => {
    if (!customers || !invoices || !receipts || !allocations) return null;
    const today = todayMidnight();
    const unpaid = invoices.filter((i) => i.status !== "paid" && i.outstanding > 0.005);
    const overdue = unpaid.filter((i) => parseISODate(i.due_date) < today);
    const totalOutstanding = unpaid.reduce((s, i) => s + i.outstanding, 0);

    const in90 = addCalendarDays(today, -90);
    const creditSales90 = invoices.filter((i) => parseISODate(i.invoice_date) >= in90).reduce((s, i) => s + i.total, 0);
    const dso = creditSales90 > 0 ? (totalOutstanding / creditSales90) * 90 : 0;

    // ---- This-month KPIs -------------------------------------------------
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const billedThisMonth = invoices.filter((i) => parseISODate(i.invoice_date) >= monthStart).reduce((s, i) => s + i.total, 0);
    const collectedThisMonth = receipts.filter((r) => parseISODate(r.receipt_date) >= monthStart).reduce((s, r) => s + r.amount, 0);

    // ---- Monthly buckets (last 6 months, oldest → newest) ----------------
    const months: { start: Date; end: Date; label: string }[] = [];
    for (let k = 5; k >= 0; k--) {
      const start = new Date(today.getFullYear(), today.getMonth() - k, 1);
      const end = new Date(today.getFullYear(), today.getMonth() - k + 1, 0); // last day of month
      const label = start.toLocaleDateString("en-IN", { month: "short" }) + (start.getMonth() === 0 || k === 5 ? ` ${String(start.getFullYear()).slice(2)}` : "");
      months.push({ start, end, label });
    }
    const monthIndex = (d: Date) => months.findIndex((m) => d >= m.start && d <= m.end);

    const billedByMonth = months.map(() => 0);
    const invCountByMonth = months.map(() => 0);
    for (const i of invoices) {
      const idx = monthIndex(parseISODate(i.invoice_date));
      if (idx >= 0) {
        billedByMonth[idx] += i.total;
        invCountByMonth[idx] += 1;
      }
    }
    const collectedByMonth = months.map(() => 0);
    for (const r of receipts) {
      const idx = monthIndex(parseISODate(r.receipt_date));
      if (idx >= 0) collectedByMonth[idx] += r.amount;
    }

    // ---- Total debtors, month-end trend ----------------------------------
    // Outstanding at date D = invoices raised on/before D − allocations whose
    // receipt was dated on/before D.
    const receiptDateById = new Map(receipts.map((r) => [r.id, parseISODate(r.receipt_date)]));
    const debtorsMonthEnd = months.map((m) => {
      const capEnd = m.end > today ? today : m.end;
      let billed = 0;
      for (const i of invoices) if (parseISODate(i.invoice_date) <= capEnd) billed += i.total;
      let collected = 0;
      for (const a of allocations) {
        const rd = receiptDateById.get(a.receipt_id);
        if (rd && rd <= capEnd) collected += a.amount;
      }
      return Math.max(0, billed - collected);
    });

    // ---- Cashflow outlook: expected collections, next 8 weeks -------------
    const weekLabels: string[] = ["Overdue"];
    const weekExpected: number[] = [0];
    for (let w = 0; w < 7; w++) {
      const ws = addCalendarDays(today, w * 7);
      weekLabels.push(formatShortDate(toISODate(ws)).replace(/ \d{4}$/, ""));
      weekExpected.push(0);
    }
    for (const i of unpaid) {
      const due = parseISODate(i.due_date);
      if (due < today) weekExpected[0] += i.outstanding;
      else {
        const w = Math.floor((due.getTime() - today.getTime()) / (7 * 86400000));
        if (w <= 6) weekExpected[w + 1] += i.outstanding;
        else weekExpected[7] += i.outstanding; // beyond the horizon folds into the last week
      }
    }
    const weekCumulative = weekExpected.reduce<number[]>((acc, v, i) => {
      acc.push((acc[i - 1] ?? 0) + v);
      return acc;
    }, []);

    // ---- Sales by customer (all-time billed, top 8) -----------------------
    const billedByCustomer = new Map<string, number>();
    for (const i of invoices) billedByCustomer.set(i.customer_id, (billedByCustomer.get(i.customer_id) ?? 0) + i.total);
    const customerById = new Map(customers.map((c) => [c.id, c]));
    const salesByCustomer = Array.from(billedByCustomer.entries())
      .map(([cid, amount]) => ({ id: cid, name: customerById.get(cid)?.name ?? "—", amount }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 8);

    // Monthly billing per top-4 customer, over the same 6 month buckets (line chart).
    const top4 = salesByCustomer.slice(0, 4);
    const top4Index = new Map(top4.map((c, i) => [c.id, i]));
    const salesTrendByCustomer = top4.map((c) => ({ name: c.name, values: months.map(() => 0) }));
    for (const i of invoices) {
      const ci = top4Index.get(i.customer_id);
      if (ci === undefined) continue;
      const mi = monthIndex(parseISODate(i.invoice_date));
      if (mi >= 0) salesTrendByCustomer[ci].values[mi] += i.total;
    }

    // ---- Overdue by customer ----------------------------------------------
    const overdueMap = new Map<string, OverdueByCustomerRow>();
    for (const i of overdue) {
      const row = overdueMap.get(i.customer_id) ?? { id: i.customer_id, name: i.customerName, invoices: 0, amount: 0, maxDays: 0 };
      row.invoices += 1;
      row.amount += i.outstanding;
      row.maxDays = Math.max(row.maxDays, daysOverdue(i.due_date));
      overdueMap.set(i.customer_id, row);
    }
    const overdueByCustomer = Array.from(overdueMap.values()).sort((a, b) => b.amount - a.amount);
    const overdueTotal = overdueByCustomer.reduce((s, r) => s + r.amount, 0);

    // ---- Status breakdown + top debtors (as before) ------------------------
    const statusStats: Record<EffectiveStatus, { count: number; amount: number }> = {
      open: { count: 0, amount: 0 },
      partial: { count: 0, amount: 0 },
      overdue: { count: 0, amount: 0 },
      paid: { count: 0, amount: 0 },
    };
    for (const inv of invoices) {
      const eff = effectiveStatus(inv.status, inv.due_date);
      statusStats[eff].count += 1;
      statusStats[eff].amount += inv.total;
    }

    const outstandingByCustomer = new Map<string, number>();
    for (const inv of unpaid) {
      outstandingByCustomer.set(inv.customer_id, (outstandingByCustomer.get(inv.customer_id) ?? 0) + inv.outstanding);
    }
    const topDebtors = Array.from(outstandingByCustomer.entries())
      .map(([customerId, outstanding]) => {
        const c = customerById.get(customerId);
        return {
          id: customerId,
          name: c?.name ?? "—",
          outstanding,
          overLimit: Boolean(c && c.credit_limit > 0 && outstanding > c.credit_limit),
        };
      })
      .sort((a, b) => b.outstanding - a.outstanding)
      .slice(0, 5);

    return {
      totalCustomers: customers.length,
      totalInvoices: invoices.length,
      overdueCount: overdue.length,
      totalOutstanding,
      dso,
      billedThisMonth,
      collectedThisMonth,
      collectionRate: invoices.length ? (receipts.reduce((s, r) => s + r.amount, 0) / Math.max(1, invoices.reduce((s, i) => s + i.total, 0))) * 100 : 0,
      monthLabels: months.map((m) => m.label),
      billedByMonth,
      invCountByMonth,
      collectedByMonth,
      debtorsMonthEnd,
      weekLabels,
      weekExpected,
      weekCumulative,
      salesByCustomer,
      salesTrendByCustomer,
      overdueByCustomer,
      overdueTotal,
      statusStats,
      topDebtors,
    };
  }, [customers, invoices, receipts, allocations]);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Dashboard"
        subtitle="Your AR at a glance — what's billed, what's collected, and what needs chasing."
        action={
          <div className="flex items-center gap-2">
            {loadedAt && (
              <span className="text-xs text-slate-400 dark:text-slate-500">
                As of {loadedAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
            <IconButton label="Refresh data" onClick={() => setReloadKey((k) => k + 1)}>
              {ActionIcons.refresh}
            </IconButton>
          </div>
        }
      />

      {!isConfigured && <NotConfigured />}

      {isConfigured && error && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-6 text-red-800 dark:border-red-500/40 dark:bg-red-950/40 dark:text-red-200">
          <p className="font-semibold">Couldn&apos;t load the dashboard.</p>
          <p className="mt-1 text-sm">{error}</p>
        </div>
      )}

      {isConfigured && !error && loading && <DashboardSkeleton />}

      {isConfigured && !error && !loading && stats && (
        <>
          {/* KPI row */}
          <div className="mb-8 grid animate-fade-in-up grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-6 lg:gap-0 lg:divide-x lg:divide-slate-200 lg:dark:divide-slate-800">
            <KpiTile icon="customers" label="Customers" value={stats.totalCustomers} color="sky" />
            <KpiTile icon="invoices" label="Invoices" value={stats.totalInvoices} color="violet" trend={stats.invCountByMonth} />
            <KpiTile icon="ageing" label="Overdue" value={stats.overdueCount} color="red" />
            <KpiTile icon="cashflow" label="Outstanding" value={stats.totalOutstanding} format={inrCompact} color="orange" trend={stats.debtorsMonthEnd} />
            <KpiTile icon="invoices" label="Billed (this mo.)" value={stats.billedThisMonth} format={inrCompact} color="indigo" trend={stats.billedByMonth} />
            <KpiTile icon="receipts" label="Collected (this mo.)" value={stats.collectedThisMonth} format={inrCompact} color="emerald" trend={stats.collectedByMonth} />
          </div>

          {/* DSO banner */}
          <div className="mb-8 flex animate-fade-in-up flex-col justify-between gap-4 rounded-xl border border-brand/20 bg-gradient-to-r from-brand-50 to-white p-5 dark:border-brand-400/20 dark:from-brand-900/20 dark:to-slate-900 sm:flex-row sm:items-center" style={{ animationDelay: "100ms" }}>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-brand dark:text-brand-300">Days Sales Outstanding (DSO)</p>
              <p className="mt-1 text-3xl font-bold text-brand dark:text-white">
                <CountUp value={stats.dso} format={(n) => n.toFixed(0)} /> days
              </p>
              <p className="mt-1 max-w-md text-xs text-slate-500 dark:text-slate-400">
                On average, how long it takes to collect payment after a sale — based on outstanding AR against the last 90 days of
                invoicing. Lower is healthier.
              </p>
            </div>
            <div className="hidden flex-none items-center gap-3 sm:flex">
              <svg viewBox="0 0 80 80" className="h-20 w-20" role="img" aria-label={`${Math.round(stats.collectionRate)}% of billed collected`}>
                <circle cx="40" cy="40" r="33" fill="none" strokeWidth="9" className="stroke-slate-200/80 dark:stroke-slate-800" />
                <circle
                  cx="40"
                  cy="40"
                  r="33"
                  fill="none"
                  strokeWidth="9"
                  strokeLinecap="round"
                  className="stroke-emerald-500"
                  strokeDasharray={`${(Math.min(100, stats.collectionRate) / 100) * 2 * Math.PI * 33} ${2 * Math.PI * 33}`}
                  transform="rotate(-90 40 40)"
                />
                <text x="40" y="45" textAnchor="middle" fontSize="16" fontWeight="800" className="fill-slate-900 dark:fill-white">
                  {Math.round(stats.collectionRate)}%
                </text>
              </svg>
              <p className="max-w-[92px] text-xs leading-snug text-slate-500 dark:text-slate-400">of billed money collected so far</p>
            </div>
          </div>

          {/* Most actionable first: the chase list + status mix */}
          <Reveal className="grid gap-10 border-t border-slate-200 pt-8 dark:border-slate-800 lg:grid-cols-2">
            <section>
              <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Overdue by Customer
              </h3>
              <p className="mb-4 text-xs text-slate-400 dark:text-slate-500">
                Who owes overdue money and how stale it is — your chase list, worst first.
              </p>
              {stats.overdueByCustomer.length === 0 ? (
                <p className="text-sm text-slate-400 dark:text-slate-500">Nothing overdue — the book is clean. 🎉</p>
              ) : (
                (() => {
                  const top = stats.overdueByCustomer.slice(0, 6);
                  const restRows = stats.overdueByCustomer.slice(6);
                  const rest = stats.overdueTotal - top.reduce((s, r) => s + r.amount, 0);
                  const segments = top.map((r, i) => ({
                    label: r.name,
                    value: r.amount,
                    colorClass: OVERDUE_DONUT_COLORS[i % OVERDUE_DONUT_COLORS.length],
                    detail: `${r.invoices} inv · ${r.maxDays}d`,
                    stale: r.maxDays > 60,
                  }));
                  if (rest > 0.005)
                    segments.push({
                      label: "Others",
                      value: rest,
                      colorClass: "text-slate-400 dark:text-slate-500",
                      detail: `${restRows.length} customers`,
                      stale: false,
                    });
                  return (
                    <div className="flex flex-wrap items-center gap-10">
                      <DonutChart segments={segments} centerValue={inrCompact(stats.overdueTotal)} centerLabel="overdue" size={180} />
                      <div className="min-w-[220px] flex-1 space-y-3">
                        {segments.map((seg) => (
                          <div key={seg.label} className="flex items-center gap-2.5 text-sm">
                            <span className={`h-2.5 w-2.5 flex-none rounded-full bg-current ${seg.colorClass}`} />
                            <span className="min-w-0">
                              <span className="block truncate font-medium text-slate-600 dark:text-slate-300">{seg.label}</span>
                              <span className={`block text-[11px] tabular-nums ${seg.stale ? "font-semibold text-red-500 dark:text-red-400" : "text-slate-400 dark:text-slate-500"}`}>
                                {seg.detail}
                              </span>
                            </span>
                            <span className="ml-auto flex-none font-semibold tabular-nums text-red-600 dark:text-red-400">
                              {inr.format(seg.value)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()
              )}
            </section>

            <section>
              <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Invoice Status Breakdown
              </h3>
              <div className="flex flex-wrap items-center gap-8">
                <DonutChart
                  segments={STATUS_ORDER.map((s) => ({
                    label: STATUS_LABEL[s],
                    value: stats.statusStats[s].count,
                    colorClass: DONUT_COLOR[s],
                  }))}
                  centerValue={String(stats.totalInvoices)}
                  centerLabel="invoices"
                />
                <div className="min-w-[190px] flex-1 space-y-3">
                  {STATUS_ORDER.map((s) => {
                    const stat = stats.statusStats[s];
                    return (
                      <div key={s} className="flex items-center gap-2.5 text-sm">
                        <span className={`h-2.5 w-2.5 flex-none rounded-full ${STATUS_BAR[s]}`} />
                        <span className="font-medium text-slate-600 dark:text-slate-300">{STATUS_LABEL[s]}</span>
                        <span className="ml-auto tabular-nums text-slate-400 dark:text-slate-500">
                          {stat.count} · {inr.format(stat.amount)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>
          </Reveal>

          {/* Who owes the most + who drives revenue */}
          <Reveal delay={80} className="mt-8 grid gap-10 border-t border-slate-200 pt-8 dark:border-slate-800 lg:grid-cols-2">
            <section>
              <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Top 5 Debtors</h3>
              <p className="mb-4 text-xs text-slate-400 dark:text-slate-500">
                Outstanding per customer, biggest first — a steep drop means your risk is concentrated in one or two accounts.
              </p>
              {stats.topDebtors.length === 0 ? (
                <p className="text-sm text-slate-400 dark:text-slate-500">No outstanding balances — everyone&apos;s paid up.</p>
              ) : (
                <>
                  <LineChart
                    labels={stats.topDebtors.map((d, i) => `${i + 1}. ${shortName(d.name)}`)}
                    series={[{ name: "Outstanding", values: stats.topDebtors.map((d) => d.outstanding), color: CHART_COLORS.orange }]}
                  />
                  {stats.topDebtors.some((d) => d.overLimit) && (
                    <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                      ⚠ Over credit limit: {stats.topDebtors.filter((d) => d.overLimit).map((d) => d.name).join(", ")}
                    </p>
                  )}
                </>
              )}
            </section>

            <section>
              <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Sales by Customer — top 8
              </h3>
              <p className="mb-4 text-xs text-slate-400 dark:text-slate-500">All-time billing share. Your revenue concentration at a glance.</p>
              {stats.salesByCustomer.length === 0 ? (
                <p className="text-sm text-slate-400 dark:text-slate-500">No invoices yet.</p>
              ) : (
                <div className="flex flex-wrap items-center gap-8">
                  <DonutChart
                    segments={stats.salesByCustomer.map((c, i) => ({
                      label: c.name,
                      value: c.amount,
                      colorClass: CUSTOMER_DONUT_COLORS[i % CUSTOMER_DONUT_COLORS.length],
                    }))}
                    centerValue={inrCompact(stats.salesByCustomer.reduce((s, c) => s + c.amount, 0))}
                    centerLabel="billed"
                  />
                  <div className="min-w-[190px] flex-1 space-y-2.5">
                    {stats.salesByCustomer.map((c, i) => (
                      <div key={c.id} className="flex items-center gap-2.5 text-xs">
                        <span className={`h-2.5 w-2.5 flex-none rounded-full bg-current ${CUSTOMER_DONUT_COLORS[i % CUSTOMER_DONUT_COLORS.length]}`} />
                        <span className="truncate font-medium text-slate-600 dark:text-slate-300">{c.name}</span>
                        <span className="ml-auto flex-none font-semibold tabular-nums text-slate-600 dark:text-slate-300">{inr.format(c.amount)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          </Reveal>

          {/* The four trend charts — two rows of two */}
          <Reveal delay={80} className="mt-8 grid gap-10 border-t border-slate-200 pt-8 dark:border-slate-800 lg:grid-cols-2">
            <section>
              <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Sales vs Collections — last 6 months
              </h3>
              <p className="mb-4 text-xs text-slate-400 dark:text-slate-500">
                Billed = invoices raised that month · Collected = money received. A widening gap means debtors are building up.
              </p>
              <LineChart
                labels={stats.monthLabels}
                series={[
                  { name: "Billed", values: stats.billedByMonth, color: CHART_COLORS.blue },
                  { name: "Collected", values: stats.collectedByMonth, color: CHART_COLORS.green },
                ]}
              />
            </section>

            <section>
              <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Customer Sales Trend — top 4
              </h3>
              <p className="mb-4 text-xs text-slate-400 dark:text-slate-500">
                Monthly billing per key customer — spot who&apos;s growing and who&apos;s going quiet.
              </p>
              <LineChart
                labels={stats.monthLabels}
                series={stats.salesTrendByCustomer.map((s, i) => ({
                  ...s,
                  color: [CHART_COLORS.blue, CHART_COLORS.orange, CHART_COLORS.green, CHART_COLORS.purple][i],
                }))}
              />
            </section>

            <section>
              <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Total Debtors — month-end trend
              </h3>
              <p className="mb-4 text-xs text-slate-400 dark:text-slate-500">
                The receivables book at each month end. A rising line means credit is piling up faster than it&apos;s collected.
              </p>
              <LineChart
                labels={stats.monthLabels}
                series={[{ name: "Debtors", values: stats.debtorsMonthEnd, color: CHART_COLORS.purple }]}
              />
            </section>

            <section>
              <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Cashflow Outlook — expected collections
              </h3>
              <p className="mb-4 text-xs text-slate-400 dark:text-slate-500">
                Open invoices by due week for the next 7 weeks (overdue shown first — chase these for immediate cash).
              </p>
              <LineChart
                labels={stats.weekLabels}
                series={[
                  { name: "Due that week", values: stats.weekExpected, color: CHART_COLORS.orange },
                  { name: "Cumulative", values: stats.weekCumulative, color: CHART_COLORS.blue, dashed: true },
                ]}
              />
            </section>
          </Reveal>

        </>
      )}
    </div>
  );
}

const KPI_COLORS: Record<string, string> = {
  sky: "bg-sky-50 text-sky-600 dark:bg-sky-900/30 dark:text-sky-300",
  violet: "bg-violet-50 text-violet-600 dark:bg-violet-900/30 dark:text-violet-300",
  red: "bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-300",
  orange: "bg-orange-50 text-orange-600 dark:bg-orange-900/30 dark:text-orange-300",
  indigo: "bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-300",
  emerald: "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300",
  brand: "bg-brand-50 text-brand dark:bg-brand-900/30 dark:text-brand-300",
};

const KPI_SPARK: Record<string, string> = {
  sky: "text-sky-500 dark:text-sky-400",
  violet: "text-violet-500 dark:text-violet-400",
  red: "text-red-500 dark:text-red-400",
  orange: "text-orange-500 dark:text-orange-400",
  indigo: "text-indigo-500 dark:text-indigo-400",
  emerald: "text-emerald-500 dark:text-emerald-400",
  brand: "text-brand dark:text-brand-300",
};

/* Tiny 6-month trend line rendered inside a KPI tile. */
function Spark({ values, colorClass }: { values: number[]; colorClass: string }) {
  if (values.length < 2) return null;
  const max = Math.max(...values);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${25 - ((v - min) / range) * 22}`).join(" ");
  return (
    <svg viewBox="0 0 100 28" preserveAspectRatio="none" className={`mt-1 h-4 w-20 ${colorClass}`} aria-hidden>
      <polyline
        points={pts}
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        opacity={0.8}
      />
    </svg>
  );
}

function KpiTile({
  icon,
  label,
  value,
  format,
  color = "brand",
  trend,
}: {
  icon: string;
  label: string;
  value: number;
  format?: (n: number) => string;
  color?: keyof typeof KPI_COLORS;
  trend?: number[];
}) {
  const iconWrap = KPI_COLORS[color] ?? KPI_COLORS.brand;
  return (
    <div className="lg:px-4 lg:first:pl-0">
      <div className="flex items-center gap-3">
        <div className={`hidden h-10 w-10 flex-none items-center justify-center rounded-lg xl:flex ${iconWrap}`}>
          <ScreenIcon name={icon} className="h-5 w-5" />
        </div>
        <div>
          <p className="text-xl font-bold tabular-nums text-slate-900 dark:text-white">
            <CountUp value={value} format={format} />
          </p>
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
          {trend && <Spark values={trend} colorClass={KPI_SPARK[color] ?? KPI_SPARK.brand} />}
        </div>
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="mb-6 grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-[64px] rounded-xl bg-slate-100 dark:bg-slate-800/60" />
        ))}
      </div>
      <div className="mb-6 h-24 rounded-xl bg-slate-100 dark:bg-slate-800/60" />
      <div className="mb-6 h-64 rounded-xl bg-slate-100 dark:bg-slate-800/60" />
      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <div className="h-56 rounded-xl bg-slate-100 dark:bg-slate-800/60" />
        <div className="h-56 rounded-xl bg-slate-100 dark:bg-slate-800/60" />
      </div>
      <div className="h-64 rounded-xl bg-slate-100 dark:bg-slate-800/60" />
    </div>
  );
}
