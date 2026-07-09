"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase, isConfigured } from "@/lib/supabase";
import { inr, parseISODate, todayMidnight, addCalendarDays, formatShortDate } from "@/lib/format";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { DataTable, type Column } from "@/components/DataTable";
import { inputClass } from "@/components/FormField";
import { ScreenIcon } from "@/components/icons";
import { StatusPill, effectiveStatus, daysOverdue, type EffectiveStatus } from "@/components/StatusPill";
import type { InvoiceStatus } from "@/lib/types";

/*
  Dashboard: the overview that pulls the rest of the app together — customers,
  invoices, and receipt_allocations, read-only. Nothing here is computed on
  the backend; every number (outstanding, overdue, status) uses the same
  rules as the Ageing report and Cashflow Projection so they always agree.

  Two "industry standard" additions beyond the base spec:
  - DSO (Days Sales Outstanding): the classic AR health metric — how many
    days of sales are currently tied up in receivables. Computed here as
    (total outstanding ÷ last-90-days invoicing) × 90.
  - Credit limit breach flag on Top Debtors: a customer whose outstanding
    balance exceeds their approved credit_limit is flagged "Over limit" —
    a standard AR control so collections knows who to stop shipping to.
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

const STATUS_ORDER: EffectiveStatus[] = ["overdue", "partial", "open", "paid"];
const STATUS_LABEL: Record<EffectiveStatus, string> = { overdue: "Overdue", partial: "Partial", open: "Open", paid: "Paid" };
const STATUS_BAR: Record<EffectiveStatus, string> = {
  overdue: "bg-red-500",
  partial: "bg-amber-500",
  open: "bg-slate-400 dark:bg-slate-500",
  paid: "bg-emerald-500",
};

export default function DashboardPage() {
  const [customers, setCustomers] = useState<CustomerLite[] | null>(null);
  const [invoices, setInvoices] = useState<InvoiceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recentStatusFilter, setRecentStatusFilter] = useState<"all" | EffectiveStatus>("all");

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const [
        { data: custData, error: custErr },
        { data: invData, error: invErr },
        { data: allocData, error: allocErr },
      ] = await Promise.all([
        supabase.from("customers").select("id, name, credit_limit"),
        supabase.from("invoices").select("id, invoice_no, invoice_date, customer_id, due_date, total, status, customers(name)"),
        supabase.from("receipt_allocations").select("invoice_id, amount"),
      ]);

      if (custErr || invErr || allocErr) {
        if (!cancelled) setError(custErr?.message || invErr?.message || allocErr?.message || "Failed to load dashboard.");
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
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loading = customers === null || invoices === null;

  const stats = useMemo(() => {
    if (!customers || !invoices) return null;
    const today = todayMidnight();
    const unpaid = invoices.filter((i) => i.status !== "paid" && i.outstanding > 0.005);
    const overdue = unpaid.filter((i) => parseISODate(i.due_date) < today);
    const totalOutstanding = unpaid.reduce((s, i) => s + i.outstanding, 0);

    const in90 = addCalendarDays(today, -90);
    const creditSales90 = invoices.filter((i) => parseISODate(i.invoice_date) >= in90).reduce((s, i) => s + i.total, 0);
    const dso = creditSales90 > 0 ? (totalOutstanding / creditSales90) * 90 : 0;

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
    const customerById = new Map(customers.map((c) => [c.id, c]));
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

    const recent = [...invoices].sort((a, b) => (a.invoice_date < b.invoice_date ? 1 : a.invoice_date > b.invoice_date ? -1 : 0));

    return {
      totalCustomers: customers.length,
      totalInvoices: invoices.length,
      overdueCount: overdue.length,
      totalOutstanding,
      dso,
      statusStats,
      topDebtors,
      recent,
    };
  }, [customers, invoices]);

  const visibleRecent = useMemo(() => {
    if (!stats) return [];
    const filtered =
      recentStatusFilter === "all"
        ? stats.recent
        : stats.recent.filter((r) => effectiveStatus(r.status, r.due_date) === recentStatusFilter);
    return filtered.slice(0, 8);
  }, [stats, recentStatusFilter]);

  const recentColumns: Column<InvoiceRow>[] = [
    {
      key: "invoice_no",
      header: "Invoice #",
      render: (r) => <span className="font-medium text-brand dark:text-brand-300">{r.invoice_no}</span>,
    },
    { key: "customerName", header: "Customer" },
    { key: "total", header: "Total", className: "text-right", render: (r) => inr.format(r.total) },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <div className="flex flex-col gap-0.5">
          <StatusPill status={r.status} dueDate={r.due_date} />
          {effectiveStatus(r.status, r.due_date) === "overdue" && (
            <span className="text-[11px] text-red-500 dark:text-red-400">{daysOverdue(r.due_date)}d overdue</span>
          )}
        </div>
      ),
    },
    { key: "due_date", header: "Due Date", render: (r) => formatShortDate(r.due_date) },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Dashboard" subtitle="Your AR at a glance — customers, invoices, and what's still owed." />

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
          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiTile icon="customers" label="Total Customers" value={stats.totalCustomers} />
            <KpiTile icon="invoices" label="Total Invoices" value={stats.totalInvoices} />
            <KpiTile icon="ageing" label="Overdue Invoices" value={stats.overdueCount} tone={stats.overdueCount > 0 ? "warn" : "default"} />
            <KpiTile icon="cashflow" label="Total Outstanding" value={inr.format(stats.totalOutstanding)} tone="brand" />
          </div>

          <div className="mb-6 flex flex-col justify-between gap-4 rounded-xl border border-brand/20 bg-gradient-to-r from-brand-50 to-white p-5 dark:border-brand-400/20 dark:from-brand-900/20 dark:to-slate-900 sm:flex-row sm:items-center">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-brand dark:text-brand-300">Days Sales Outstanding (DSO)</p>
              <p className="mt-1 text-3xl font-bold text-brand dark:text-white">{stats.dso.toFixed(0)} days</p>
              <p className="mt-1 max-w-md text-xs text-slate-500 dark:text-slate-400">
                On average, how long it takes to collect payment after a sale — based on outstanding AR against the last 90 days of
                invoicing. Lower is healthier.
              </p>
            </div>
            <ScreenIcon name="cashflow" className="hidden h-16 w-16 flex-none text-brand/20 dark:text-brand-300/20 sm:block" />
          </div>

          <div className="mb-6 grid gap-6 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Invoice Status Breakdown
              </h3>
              <div className="space-y-4">
                {STATUS_ORDER.map((s) => {
                  const stat = stats.statusStats[s];
                  const pct = stats.totalInvoices ? (stat.count / stats.totalInvoices) * 100 : 0;
                  return (
                    <div key={s}>
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="font-medium text-slate-600 dark:text-slate-300">{STATUS_LABEL[s]}</span>
                        <span className="text-slate-400 dark:text-slate-500">
                          {stat.count} · {inr.format(stat.amount)}
                        </span>
                      </div>
                      <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                        <div
                          className={`h-full rounded-full transition-all ${STATUS_BAR[s]}`}
                          style={{ width: `${stat.count > 0 ? Math.max(pct, 2) : 0}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Top 5 Debtors</h3>
              {stats.topDebtors.length === 0 ? (
                <p className="text-sm text-slate-400 dark:text-slate-500">No outstanding balances — everyone&apos;s paid up.</p>
              ) : (
                <div className="space-y-4">
                  {stats.topDebtors.map((d, i) => {
                    const pct = stats.totalOutstanding ? (d.outstanding / stats.totalOutstanding) * 100 : 0;
                    return (
                      <div key={d.id}>
                        <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                          <span className="flex items-center gap-2 font-medium text-slate-700 dark:text-slate-200">
                            <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-brand-50 text-[10px] font-bold text-brand dark:bg-brand-900/40 dark:text-brand-300">
                              {i + 1}
                            </span>
                            {d.name}
                            {d.overLimit && (
                              <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-600 dark:bg-red-900/40 dark:text-red-300">
                                Over limit
                              </span>
                            )}
                          </span>
                          <span className="flex-none font-semibold text-slate-600 dark:text-slate-300">{inr.format(d.outstanding)}</span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                          <div className="h-full rounded-full bg-brand dark:bg-brand-400" style={{ width: `${Math.max(pct, 2)}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Recent Invoices</h3>
              <select
                aria-label="Filter recent invoices by status"
                className={`${inputClass} w-auto py-1.5 text-xs`}
                value={recentStatusFilter}
                onChange={(e) => setRecentStatusFilter(e.target.value as "all" | EffectiveStatus)}
              >
                <option value="all">All statuses</option>
                {STATUS_ORDER.map((s) => (
                  <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                ))}
              </select>
            </div>
            <DataTable columns={recentColumns} rows={visibleRecent} getRowHref={(r) => `/invoices/${r.id}`} empty="No invoices match this filter." />
          </div>
        </>
      )}
    </div>
  );
}

function KpiTile({
  icon,
  label,
  value,
  tone = "default",
}: {
  icon: string;
  label: string;
  value: string | number;
  tone?: "default" | "brand" | "warn";
}) {
  const iconWrap =
    tone === "warn"
      ? "bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-300"
      : "bg-brand-50 text-brand dark:bg-brand-900/30 dark:text-brand-300";
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 transition-shadow hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-3">
        <div className={`flex h-11 w-11 flex-none items-center justify-center rounded-lg ${iconWrap}`}>
          <ScreenIcon name={icon} className="h-5 w-5" />
        </div>
        <div>
          <p className="text-2xl font-bold text-slate-900 dark:text-white">{value}</p>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
        </div>
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[84px] rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-800/60" />
        ))}
      </div>
      <div className="mb-6 h-24 rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-800/60" />
      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <div className="h-56 rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-800/60" />
        <div className="h-56 rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-800/60" />
      </div>
      <div className="h-64 rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-800/60" />
    </div>
  );
}
