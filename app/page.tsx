"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase, isConfigured } from "@/lib/supabase";
import { inr, inrCompact, parseISODate, todayMidnight, formatShortDate } from "@/lib/format";
import { NotConfigured } from "@/components/NotConfigured";
import { ScreenIcon } from "@/components/icons";
import { CountUp } from "@/components/CountUp";
import { Reveal } from "@/components/Reveal";
import { StatusPill } from "@/components/StatusPill";
import type { InvoiceStatus } from "@/lib/types";

/*
  Home — the AR Manager command centre. A time-of-day greeting, live headline
  numbers, one-click quick actions into every workflow, a "needs attention"
  chase list, and the latest activity — all from the same live data as the
  dashboard, wrapped in the house animations.
*/

interface InvoiceRow {
  id: string;
  invoice_no: string;
  invoice_date: string;
  due_date: string;
  total: number;
  status: InvoiceStatus;
  customerName: string;
  outstanding: number;
  daysOverdue: number;
}

const QUICK_ACTIONS: { href: string; label: string; desc: string; icon: string; classes: string }[] = [
  {
    href: "/invoices/new",
    label: "New Invoice",
    desc: "Punch a fresh invoice",
    icon: "invoices",
    classes: "from-sky-500 to-blue-600",
  },
  {
    href: "/receipts",
    label: "Record Payment",
    desc: "Knock off open invoices",
    icon: "receipts",
    classes: "from-emerald-500 to-green-600",
  },
  {
    href: "/masters/customers/new",
    label: "Add Customer",
    desc: "Onboard a new account",
    icon: "customers",
    classes: "from-violet-500 to-purple-600",
  },
  {
    href: "/reminders",
    label: "Send Reminders",
    desc: "Chase every overdue in one go",
    icon: "reminders",
    classes: "from-amber-500 to-orange-600",
  },
  {
    href: "/reports/ageing",
    label: "AR Ageing",
    desc: "Who's late, and how late",
    icon: "ageing",
    classes: "from-rose-500 to-red-600",
  },
  {
    href: "/reports/statement",
    label: "Statement",
    desc: "A customer's running ledger",
    icon: "statement",
    classes: "from-teal-500 to-cyan-600",
  },
  {
    href: "/cashflow",
    label: "Cashflow",
    desc: "Cash expected, week by week",
    icon: "cashflow",
    classes: "from-indigo-500 to-blue-700",
  },
  {
    href: "/upload",
    label: "Bulk Upload",
    desc: "Import customers from CSV",
    icon: "upload",
    classes: "from-fuchsia-500 to-pink-600",
  },
];

export default function HomePage() {
  const [invoices, setInvoices] = useState<InvoiceRow[] | null>(null);
  const [receipts, setReceipts] = useState<{ receipt_no: string; receipt_date: string; amount: number; customerName: string }[] | null>(null);
  const [customers, setCustomers] = useState<{ name: string; credit_limit: number }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const [inv, alloc, rcpt, cust] = await Promise.all([
        supabase.from("invoices").select("id, invoice_no, invoice_date, due_date, total, status, customers(name)"),
        supabase.from("receipt_allocations").select("invoice_id, amount"),
        supabase.from("receipts").select("receipt_no, receipt_date, amount, customers(name)"),
        supabase.from("customers").select("name, credit_limit"),
      ]);
      if (inv.error || alloc.error || rcpt.error || cust.error) {
        if (!cancelled) setError(inv.error?.message ?? alloc.error?.message ?? rcpt.error?.message ?? cust.error?.message ?? "Failed to load.");
        return;
      }
      const paidBy: Record<string, number> = {};
      for (const a of alloc.data ?? []) paidBy[a.invoice_id] = (paidBy[a.invoice_id] ?? 0) + Number(a.amount);
      const today = todayMidnight();
      const built: InvoiceRow[] = (inv.data ?? []).map((i) => {
        const customer = Array.isArray(i.customers) ? i.customers[0] : i.customers;
        const outstanding = Math.max(0, Number(i.total) - (paidBy[i.id] ?? 0));
        const due = parseISODate(i.due_date);
        const overdue = i.status !== "paid" && outstanding > 0.005 && due < today;
        return {
          id: i.id,
          invoice_no: i.invoice_no,
          invoice_date: i.invoice_date,
          due_date: i.due_date,
          total: Number(i.total),
          status: i.status,
          customerName: (customer as { name?: string } | null)?.name ?? "—",
          outstanding,
          daysOverdue: overdue ? Math.round((today.getTime() - due.getTime()) / 86400000) : 0,
        };
      });
      if (!cancelled) {
        setInvoices(built);
        setReceipts(
          (rcpt.data ?? []).map((r) => {
            const customer = Array.isArray(r.customers) ? r.customers[0] : r.customers;
            return {
              receipt_no: r.receipt_no,
              receipt_date: r.receipt_date,
              amount: Number(r.amount),
              customerName: (customer as { name?: string } | null)?.name ?? "—",
            };
          })
        );
        setCustomers((cust.data ?? []).map((c) => ({ name: c.name, credit_limit: Number(c.credit_limit) })));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const stats = useMemo(() => {
    if (!invoices || !receipts || !customers) return null;
    const today = todayMidnight();
    const unpaid = invoices.filter((i) => i.outstanding > 0.005);
    const overdue = unpaid.filter((i) => i.daysOverdue > 0);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const collectedThisMonth = receipts.filter((r) => parseISODate(r.receipt_date) >= monthStart).reduce((s, r) => s + r.amount, 0);
    const dueThisWeek = unpaid.filter((i) => {
      const due = parseISODate(i.due_date);
      const diff = (due.getTime() - today.getTime()) / 86400000;
      return diff >= 0 && diff <= 7;
    });
    const outstandingByCustomer = new Map<string, number>();
    for (const i of unpaid) outstandingByCustomer.set(i.customerName, (outstandingByCustomer.get(i.customerName) ?? 0) + i.outstanding);
    const overLimit = customers.filter((c) => c.credit_limit > 0 && (outstandingByCustomer.get(c.name) ?? 0) > c.credit_limit);
    const chase = overdue
      .slice()
      .sort((a, b) => b.outstanding * (1 + b.daysOverdue / 30) - a.outstanding * (1 + a.daysOverdue / 30))
      .slice(0, 4);
    const recentInvoices = invoices.slice().sort((a, b) => (a.invoice_date < b.invoice_date ? 1 : -1)).slice(0, 5);
    const recentReceipts = receipts.slice().sort((a, b) => (a.receipt_date < b.receipt_date ? 1 : -1)).slice(0, 5);
    return {
      totalOutstanding: unpaid.reduce((s, i) => s + i.outstanding, 0),
      overdueAmount: overdue.reduce((s, i) => s + i.outstanding, 0),
      overdueCount: overdue.length,
      collectedThisMonth,
      expectedThisWeek: dueThisWeek.reduce((s, i) => s + i.outstanding, 0),
      dueThisWeekCount: dueThisWeek.length,
      overLimit,
      chase,
      recentInvoices,
      recentReceipts,
    };
  }, [invoices, receipts, customers]);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const todayLabel = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="mx-auto max-w-6xl">
      {!isConfigured && <NotConfigured />}

      {/* Hero greeting */}
      <div className="relative mb-8 animate-fade-in-up overflow-hidden rounded-2xl bg-gradient-to-br from-brand-700 via-brand to-brand-900 p-8 text-white">
        <div className="pointer-events-none absolute -top-16 -right-16 h-56 w-56 rounded-full bg-accent/25 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 left-1/3 h-56 w-56 rounded-full bg-white/10 blur-3xl" />
        <div className="relative">
          <p className="text-sm text-brand-100">{todayLabel}</p>
          <h1 className="mt-1 text-3xl font-bold">
            {greeting}, Vervian 👋
          </h1>
          <p className="mt-2 max-w-xl text-sm text-brand-100">
            Here's where your receivables stand right now — and everything you can do about them.
          </p>
        </div>

        {/* Live headline numbers inside the hero */}
        <div className="relative mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {stats ? (
            <>
              <HeroStat label="Total Outstanding" value={stats.totalOutstanding} accent="text-amber-300" />
              <HeroStat label={`Overdue (${stats.overdueCount} inv.)`} value={stats.overdueAmount} accent="text-red-300" />
              <HeroStat label="Collected this month" value={stats.collectedThisMonth} accent="text-emerald-300" />
              <HeroStat label={`Due this week (${stats.dueThisWeekCount})`} value={stats.expectedThisWeek} accent="text-sky-300" />
            </>
          ) : (
            [0, 1, 2, 3].map((i) => <div key={i} className="h-16 animate-pulse rounded-lg bg-white/10" />)
          )}
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-500/40 dark:bg-red-950/40 dark:text-red-200">
          Couldn&apos;t load live numbers: {error}
        </div>
      )}

      {/* Quick actions */}
      <Reveal>
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Quick actions</h2>
        <p className="mb-4 text-xs text-slate-400 dark:text-slate-500">Jump straight into any workflow.</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {QUICK_ACTIONS.map((a, i) => (
            <Link
              key={a.href + a.label}
              href={a.href}
              className={`group animate-fade-in-up rounded-xl bg-gradient-to-br p-4 text-white shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-lg ${a.classes}`}
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <ScreenIcon name={a.icon} className="h-6 w-6 transition-transform duration-200 group-hover:scale-110" />
              <p className="mt-3 font-semibold leading-tight">{a.label}</p>
              <p className="mt-0.5 text-xs text-white/75">{a.desc}</p>
            </Link>
          ))}
        </div>
      </Reveal>

      {/* Needs attention + recent activity */}
      <div className="mt-10 grid gap-10 border-t border-slate-200 pt-8 dark:border-slate-800 lg:grid-cols-2">
        <Reveal>
          <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            <span className="flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-2.5 w-2.5 animate-ping rounded-full bg-red-400 opacity-60" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
            </span>
            Needs attention
          </h2>
          <p className="mb-4 text-xs text-slate-400 dark:text-slate-500">Your chase list, worst first.</p>
          {!stats ? (
            <p className="text-sm text-slate-400">Loading…</p>
          ) : stats.chase.length === 0 ? (
            <p className="text-sm text-emerald-600 dark:text-emerald-400">Nothing overdue — the book is clean. 🎉</p>
          ) : (
            <div className="space-y-2">
              {stats.chase.map((i, k) => (
                <Link
                  key={i.id}
                  href={`/invoices/${i.id}`}
                  className="flex items-center gap-3 rounded-lg border-l-4 border-red-400 bg-red-50/60 px-4 py-2.5 transition-all hover:translate-x-1 hover:bg-red-50 dark:bg-red-950/30 dark:hover:bg-red-950/50"
                >
                  <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-red-100 text-xs font-bold text-red-600 dark:bg-red-900/50 dark:text-red-300">
                    {k + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-800 dark:text-slate-200">{i.customerName}</span>
                    <span className="text-xs text-slate-400 dark:text-slate-500">
                      {i.invoice_no} · {i.daysOverdue} days late
                    </span>
                  </span>
                  <span className="flex-none text-sm font-semibold tabular-nums text-red-600 dark:text-red-400">{inr.format(i.outstanding)}</span>
                </Link>
              ))}
              {stats.overLimit.length > 0 && (
                <p className="pt-1 text-xs text-amber-600 dark:text-amber-400">
                  ⚠ Over credit limit: {stats.overLimit.map((c) => c.name).join(", ")}
                </p>
              )}
            </div>
          )}
        </Reveal>

        <Reveal delay={80}>
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Recent activity</h2>
          <p className="mb-4 text-xs text-slate-400 dark:text-slate-500">Latest invoices and money in.</p>
          {!stats ? (
            <p className="text-sm text-slate-400">Loading…</p>
          ) : (
            <div className="space-y-2">
              {stats.recentReceipts.slice(0, 2).map((r) => (
                <div key={r.receipt_no} className="flex items-center gap-3 rounded-lg border-l-4 border-emerald-400 bg-emerald-50/60 px-4 py-2.5 dark:bg-emerald-950/30">
                  <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-900/50 dark:text-emerald-300">
                    <ScreenIcon name="receipts" className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-800 dark:text-slate-200">{r.customerName}</span>
                    <span className="text-xs text-slate-400 dark:text-slate-500">
                      {r.receipt_no} · {formatShortDate(r.receipt_date)}
                    </span>
                  </span>
                  <span className="flex-none text-sm font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                    +{inr.format(r.amount)}
                  </span>
                </div>
              ))}
              {stats.recentInvoices.slice(0, 3).map((i) => (
                <Link
                  key={i.id}
                  href={`/invoices/${i.id}`}
                  className="flex items-center gap-3 rounded-lg border-l-4 border-brand-300 bg-brand-50/60 px-4 py-2.5 transition-all hover:translate-x-1 hover:bg-brand-50 dark:border-brand-700 dark:bg-brand-900/20 dark:hover:bg-brand-900/40"
                >
                  <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-brand-100 text-brand dark:bg-brand-900/50 dark:text-brand-300">
                    <ScreenIcon name="invoices" className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-800 dark:text-slate-200">{i.customerName}</span>
                    <span className="text-xs text-slate-400 dark:text-slate-500">
                      {i.invoice_no} · {formatShortDate(i.invoice_date)}
                    </span>
                  </span>
                  <span className="mr-2 flex-none text-sm font-semibold tabular-nums text-slate-700 dark:text-slate-300">{inr.format(i.total)}</span>
                  <StatusPill status={i.status} dueDate={i.due_date} />
                </Link>
              ))}
            </div>
          )}
        </Reveal>
      </div>

      {/* Aria + dashboard callout */}
      <Reveal className="mt-10 border-t border-slate-200 pt-8 dark:border-slate-800">
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-gradient-to-r from-violet-600 via-brand to-sky-600 p-6 text-white">
          <div className="flex items-center gap-4">
            <span className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-white/15 backdrop-blur-sm">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
              </svg>
            </span>
            <div>
              <h3 className="font-bold">Not sure where to look? Ask Aria.</h3>
              <p className="text-sm text-white/75">
                Try &ldquo;who should we chase first?&rdquo; or &ldquo;what&apos;s expected this month?&rdquo; — bottom-right corner, any screen.
              </p>
            </div>
          </div>
          <Link
            href="/dashboard"
            className="flex-none rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-brand transition-transform duration-200 hover:scale-105 active:scale-95"
          >
            Open Dashboard →
          </Link>
        </div>
      </Reveal>
    </div>
  );
}

function HeroStat({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="rounded-lg bg-white/10 px-4 py-3 backdrop-blur-sm">
      <p className={`text-xl font-bold tabular-nums ${accent}`}>
        <CountUp value={value} format={inrCompact} />
      </p>
      <p className="mt-0.5 text-xs text-brand-100">{label}</p>
    </div>
  );
}
