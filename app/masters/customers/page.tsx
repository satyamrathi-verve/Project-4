"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase, isConfigured } from "@/lib/supabase";
import type { Customer, CustomerStatus } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { DataTable, type Column } from "@/components/DataTable";

const STATUS_FILTERS: { label: string; value: CustomerStatus | "ALL" }[] = [
  { label: "All statuses", value: "ALL" },
  { label: "Active", value: "ACTIVE" },
  { label: "Inactive", value: "INACTIVE" },
  { label: "Blacklisted", value: "BLACKLISTED" },
];

const STATUS_BADGE: Record<CustomerStatus, string> = {
  ACTIVE: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
  INACTIVE: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
  BLACKLISTED: "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300",
};

function formatCurrency(n: number) {
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** opening_balance is signed: positive = owed to us. A negative (credit) balance isn't a receivable. */
function receivablesOf(c: Customer) {
  return Math.max(c.opening_balance, 0);
}

export default function CustomerMasterPage() {
  const router = useRouter();
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [outstandingByCustomer, setOutstandingByCustomer] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<CustomerStatus | "ALL">("ALL");

  useEffect(() => {
    if (!supabase) return;
    (async () => {
      const [custRes, invRes, allocRes] = await Promise.all([
        supabase.from("customers").select("*").order("code"),
        supabase.from("invoices").select("id, customer_id, total, status"),
        supabase.from("receipt_allocations").select("invoice_id, amount"),
      ]);
      if (custRes.error) {
        setError(custRes.error.message);
        return;
      }
      setCustomers((custRes.data ?? []) as Customer[]);

      if (!invRes.error && !allocRes.error) {
        const invoices = (invRes.data ?? []) as { id: string; customer_id: string; total: number; status: string }[];
        const allocations = (allocRes.data ?? []) as { invoice_id: string; amount: number }[];
        const allocatedByInvoice: Record<string, number> = {};
        for (const a of allocations) {
          allocatedByInvoice[a.invoice_id] = (allocatedByInvoice[a.invoice_id] ?? 0) + a.amount;
        }
        const byCustomer: Record<string, number> = {};
        for (const inv of invoices) {
          const remaining = Math.max(0, inv.total - (allocatedByInvoice[inv.id] ?? 0));
          if (remaining > 0) byCustomer[inv.customer_id] = (byCustomer[inv.customer_id] ?? 0) + remaining;
        }
        setOutstandingByCustomer(byCustomer);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    if (!customers) return [];
    const q = search.trim().toLowerCase();
    return customers
      .filter((c) => {
        if (statusFilter !== "ALL" && c.status !== statusFilter) return false;
        if (!q) return true;
        return c.name.toLowerCase().includes(q) || (c.email ?? "").toLowerCase().includes(q);
      })
      .sort((a, b) => receivablesOf(b) - receivablesOf(a));
  }, [customers, search, statusFilter]);

  const columns: Column<Customer>[] = [
    { key: "name", header: "Customer Name" },
    { key: "email", header: "Email", render: (c) => c.email || "–" },
    { key: "registration_type", header: "GST Treatment" },
    {
      key: "status",
      header: "Status",
      render: (c) => (
        <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[c.status]}`}>{c.status}</span>
      ),
    },
    {
      key: "receivables",
      header: "Receivables",
      className: "text-right",
      render: (c) => formatCurrency(receivablesOf(c)),
    },
    {
      key: "credit_used",
      header: "Credit Used",
      sortValue: (c) =>
        c.credit_limit > 0 ? ((outstandingByCustomer[c.id] ?? 0) / c.credit_limit) * 100 : -1,
      render: (c) => {
        if (c.credit_limit <= 0) {
          return <span className="text-slate-400 dark:text-slate-500">—</span>;
        }
        const outstanding = outstandingByCustomer[c.id] ?? 0;
        const pct = (outstanding / c.credit_limit) * 100;
        const width = outstanding > 0 ? Math.max(Math.min(pct, 100), 2) : 0;
        const barColor = pct >= 90 ? "bg-red-500" : pct >= 60 ? "bg-amber-500" : "bg-emerald-500";
        return (
          <div
            className="flex items-center gap-2"
            title={`${formatCurrency(outstanding)} outstanding of ${formatCurrency(c.credit_limit)} limit`}
          >
            <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div className={`h-full rounded-full ${barColor}`} style={{ width: `${width}%` }} />
            </div>
            <span
              className={`text-xs tabular-nums ${pct >= 90 ? "text-red-600 dark:text-red-400" : "text-slate-500 dark:text-slate-400"}`}
            >
              {Math.round(pct)}%
            </span>
          </div>
        );
      },
    },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Customer Master"
        subtitle="Every customer the AR team bills, chases and collects from."
        action={
          isConfigured && (
            <Link
              href="/masters/customers/new"
              className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition-all duration-200 hover:bg-brand-700 active:scale-95"
            >
              Add Customer
            </Link>
          )
        }
      />

      {!isConfigured && <NotConfigured />}

      {isConfigured && error && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-6 text-red-800 dark:border-red-500/40 dark:bg-red-950/40 dark:text-red-200">
          <p className="font-semibold">Couldn&apos;t load customers.</p>
          <p className="mt-1 text-sm">{error}</p>
        </div>
      )}

      {isConfigured && !error && customers === null && (
        <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>
      )}

      {isConfigured && !error && customers && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <input
              type="text"
              placeholder="Search by name or email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full max-w-xs border-0 border-b border-slate-300 bg-transparent px-1 py-2 text-sm text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-b-2 focus:border-brand dark:border-slate-700 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-brand-400"
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as CustomerStatus | "ALL")}
              className="border-0 border-b border-slate-300 bg-transparent py-2 pl-1 pr-7 text-sm text-slate-800 outline-none transition-colors focus:border-b-2 focus:border-brand dark:border-slate-700 dark:text-slate-100 dark:focus:border-brand-400"
            >
              {STATUS_FILTERS.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
            <span className="text-xs text-slate-400 dark:text-slate-500">
              {filtered.length} of {customers.length} customers
            </span>
          </div>

          <DataTable
            columns={columns}
            rows={filtered}
            empty="No customers match your search."
            onRowClick={(c) => router.push(`/masters/customers/${c.id}`)}
          />
        </>
      )}
    </div>
  );
}
