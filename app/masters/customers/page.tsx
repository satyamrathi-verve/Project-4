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
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<CustomerStatus | "ALL">("ALL");

  useEffect(() => {
    if (!supabase) return;
    (async () => {
      const { data, error } = await supabase.from("customers").select("*").order("code");
      if (error) {
        setError(error.message);
        return;
      }
      setCustomers((data ?? []) as Customer[]);
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
              className="w-full max-w-xs rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-brand focus:ring-1 focus:ring-brand dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as CustomerStatus | "ALL")}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-brand focus:ring-1 focus:ring-brand dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
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
