"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase, isConfigured } from "@/lib/supabase";
import type { Customer, Invoice, InvoiceStatus, ReceiptAllocation } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { DataTable, type Column } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { FormField, inputClass } from "@/components/FormField";
import { formatCurrency, formatDate } from "@/lib/format";
import { buildAllocationMap, paidAmount, balanceDue, displayStatus } from "@/lib/invoice";

interface InvoiceRow {
  id: string;
  invoice_no: string;
  invoice_date: string;
  customerName: string;
  total: number;
  paid: number;
  balance: number;
  status: InvoiceStatus;
}

const STATUS_OPTIONS: { value: "all" | InvoiceStatus; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "open", label: "Open" },
  { value: "partial", label: "Partial" },
  { value: "paid", label: "Paid" },
  { value: "overdue", label: "Overdue" },
];

export default function InvoiceListPage() {
  const [rows, setRows] = useState<InvoiceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | InvoiceStatus>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  async function load() {
    if (!supabase) return;
    setError(null);
    const [{ data: invoices, error: invErr }, { data: customers, error: custErr }, { data: allocations, error: allocErr }] =
      await Promise.all([
        supabase.from("invoices").select("*"),
        supabase.from("customers").select("*"),
        supabase.from("receipt_allocations").select("*"),
      ]);

    if (invErr || custErr || allocErr) {
      setError(invErr?.message || custErr?.message || allocErr?.message || "Failed to load invoices.");
      return;
    }

    const customerMap = new Map<string, Customer>();
    for (const c of (customers ?? []) as Customer[]) customerMap.set(c.id, c);
    const allocationMap = buildAllocationMap((allocations ?? []) as ReceiptAllocation[]);

    const built: InvoiceRow[] = ((invoices ?? []) as Invoice[]).map((inv) => {
      const paid = paidAmount(inv.id, allocationMap);
      return {
        id: inv.id,
        invoice_no: inv.invoice_no,
        invoice_date: inv.invoice_date,
        customerName: customerMap.get(inv.customer_id)?.name ?? "Unknown customer",
        total: inv.total,
        paid,
        balance: balanceDue(inv, paid),
        status: displayStatus(inv),
      };
    });

    built.sort((a, b) => (a.invoice_date < b.invoice_date ? 1 : a.invoice_date > b.invoice_date ? -1 : b.invoice_no.localeCompare(a.invoice_no)));
    setRows(built);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleDelete(row: InvoiceRow) {
    if (!supabase) return;
    const confirmed = window.confirm(
      `Delete invoice ${row.invoice_no}?\n\nThis also permanently removes its line items and any receipt allocations linked to it — if a receipt was partly applied to this invoice, that link is lost too. This cannot be undone.`
    );
    if (!confirmed) return;
    setDeletingId(row.id);
    setNotice(null);
    const { error: delErr } = await supabase.from("invoices").delete().eq("id", row.id);
    setDeletingId(null);
    if (delErr) {
      setError(delErr.message);
      return;
    }
    setNotice(`Invoice ${row.invoice_no} deleted.`);
    load();
  }

  const filtered = (rows ?? []).filter((r) => {
    if (status !== "all" && r.status !== status) return false;
    if (dateFrom && r.invoice_date < dateFrom) return false;
    if (dateTo && r.invoice_date > dateTo) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      if (!r.invoice_no.toLowerCase().includes(q) && !r.customerName.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const columns: Column<InvoiceRow>[] = [
    {
      key: "invoice_no",
      header: "Invoice Number",
      className: "whitespace-nowrap",
      render: (r) => (
        <Link href={`/invoices/${r.id}`} className="font-medium text-brand hover:underline dark:text-brand-300">
          {r.invoice_no}
        </Link>
      ),
    },
    { key: "invoice_date", header: "Invoice Date", className: "whitespace-nowrap", render: (r) => formatDate(r.invoice_date) },
    { key: "customerName", header: "Customer" },
    { key: "total", header: "Total Amount", className: "whitespace-nowrap text-right", render: (r) => formatCurrency(r.total) },
    { key: "paid", header: "Paid Amount", className: "whitespace-nowrap text-right", render: (r) => formatCurrency(r.paid) },
    {
      key: "balance",
      header: "Balance",
      className: "whitespace-nowrap text-right",
      render: (r) => (
        <span className={r.balance > 0.005 ? "font-medium text-red-600 dark:text-red-400" : ""}>
          {formatCurrency(r.balance)}
        </span>
      ),
    },
    { key: "status", header: "Status", className: "whitespace-nowrap", render: (r) => <StatusBadge status={r.status} /> },
    {
      key: "actions",
      header: "Actions",
      className: "whitespace-nowrap",
      render: (r) => (
        <div className="flex items-center gap-3 text-sm">
          <Link href={`/invoices/${r.id}`} className="font-medium text-brand hover:underline dark:text-brand-300">
            View
          </Link>
          <Link href={`/invoices/${r.id}/edit`} className="font-medium text-brand hover:underline dark:text-brand-300">
            Edit
          </Link>
          <Link href={`/invoices/${r.id}?print=1`} className="font-medium text-brand hover:underline dark:text-brand-300">
            Print
          </Link>
          <button
            type="button"
            disabled={deletingId === r.id}
            onClick={() => handleDelete(r)}
            className="font-medium text-red-600 hover:underline disabled:opacity-50 disabled:no-underline dark:text-red-400"
          >
            {deletingId === r.id ? "Deleting…" : "Delete"}
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Sales Invoices"
        subtitle="Search, filter, and manage every invoice."
        action={
          isConfigured && (
            <Link
              href="/invoices/new"
              className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition-all duration-200 hover:bg-brand-700 active:scale-95"
            >
              + New Invoice
            </Link>
          )
        }
      />

      {!isConfigured && <NotConfigured />}

      {isConfigured && (
        <>
          {notice && (
            <div role="status" className="mb-4 rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-950/40 dark:text-emerald-200">
              {notice}
            </div>
          )}

          {error && (
            <div role="alert" className="mb-4 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-500/40 dark:bg-red-950/40 dark:text-red-200">
              {error}
            </div>
          )}

          <div className="mb-4 grid gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 sm:grid-cols-2 lg:grid-cols-4">
            <FormField label="Search">
              <input
                className={inputClass}
                placeholder="Invoice number or customer…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </FormField>
            <FormField label="Status">
              <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value as "all" | InvoiceStatus)}>
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="From date">
              <input type="date" className={inputClass} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </FormField>
            <FormField label="To date">
              <input type="date" className={inputClass} value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </FormField>
          </div>

          {rows === null ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>
          ) : (
            <DataTable columns={columns} rows={filtered} empty="No invoices match your filters." />
          )}
        </>
      )}
    </div>
  );
}
