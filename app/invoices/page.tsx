"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { supabase, isConfigured } from "@/lib/supabase";
import type { Customer, Invoice, InvoiceStatus, ReceiptAllocation } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { DataTable, type Column } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { FormField, openInputClass } from "@/components/FormField";
import { formatCurrency, formatDate, todayISO } from "@/lib/format";
import { buildAllocationMap, paidAmount, balanceDue, displayStatus } from "@/lib/invoice";
import { downloadCsv } from "@/lib/csv";
import { ExportButton } from "@/components/ExportButton";
import { IconButton, IconLink, ActionIcons } from "@/components/IconButton";
import { toast } from "@/components/Toast";

interface InvoiceRow {
  id: string;
  invoice_no: string;
  invoice_date: string;
  customer_id: string;
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
  const searchParams = useSearchParams();
  const customerId = searchParams.get("customer");

  const [rows, setRows] = useState<InvoiceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | InvoiceStatus>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [amountMin, setAmountMin] = useState("");
  const [amountMax, setAmountMax] = useState("");

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
        customer_id: inv.customer_id,
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
    const { error: delErr } = await supabase.from("invoices").delete().eq("id", row.id);
    setDeletingId(null);
    if (delErr) {
      setError(delErr.message);
      return;
    }
    toast(`Invoice ${row.invoice_no} deleted`);
    load();
  }

  const filtered = (rows ?? []).filter((r) => {
    if (customerId && r.customer_id !== customerId) return false;
    if (status !== "all" && r.status !== status) return false;
    if (dateFrom && r.invoice_date < dateFrom) return false;
    if (dateTo && r.invoice_date > dateTo) return false;
    if (amountMin !== "" && r.total < Number(amountMin)) return false;
    if (amountMax !== "" && r.total > Number(amountMax)) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      if (!r.invoice_no.toLowerCase().includes(q) && !r.customerName.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const customerFilterName = customerId ? (rows ?? []).find((r) => r.customer_id === customerId)?.customerName : null;

  function handleExport() {
    downloadCsv(
      `sales-invoices-${todayISO()}.csv`,
      ["Invoice Number", "Invoice Date", "Customer", "Total Amount", "Paid Amount", "Balance", "Status"],
      filtered.map((r) => [
        r.invoice_no,
        formatDate(r.invoice_date),
        r.customerName,
        r.total.toFixed(2),
        r.paid.toFixed(2),
        r.balance.toFixed(2),
        r.status,
      ])
    );
  }

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
      sortable: false,
      render: (r) => (
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <IconLink label="View" href={`/invoices/${r.id}`} shape="ghost">
            {ActionIcons.view}
          </IconLink>
          <IconLink label="Edit" href={`/invoices/${r.id}/edit`} shape="ghost">
            {ActionIcons.edit}
          </IconLink>
          <IconLink label="Print" href={`/invoices/${r.id}?print=1`} shape="ghost">
            {ActionIcons.print}
          </IconLink>
          <IconButton
            label={deletingId === r.id ? "Deleting…" : "Delete"}
            shape="ghost"
            variant="danger"
            disabled={deletingId === r.id}
            onClick={() => handleDelete(r)}
          >
            {deletingId === r.id ? ActionIcons.spinner : ActionIcons.delete}
          </IconButton>
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
            <div className="flex flex-wrap items-center gap-2">
              <ExportButton onClick={handleExport} />
              <Link
                href="/invoices/recurring"
                className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:border-brand hover:text-brand dark:border-slate-700 dark:text-slate-300 dark:hover:border-brand-400 dark:hover:text-brand-300"
              >
                <span className="[&>svg]:h-4 [&>svg]:w-4">{ActionIcons.repeat}</span>
                Recurring
              </Link>
              <Link
                href="/invoices/new"
                className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition-all duration-200 hover:bg-brand-700 active:scale-95"
              >
                + New Invoice
              </Link>
            </div>
          )
        }
      />

      {!isConfigured && <NotConfigured />}

      {isConfigured && (
        <>
          {customerId && (
            <div className="mb-4 flex items-center gap-2 text-sm">
              <span className="inline-flex items-center gap-2 rounded-full bg-brand-50 px-3 py-1 font-medium text-brand dark:bg-brand-900/30 dark:text-brand-300">
                Customer: {customerFilterName ?? "…"}
                <Link href="/invoices" className="text-brand/70 hover:text-brand dark:text-brand-300/70 dark:hover:text-brand-300" aria-label="Clear customer filter">
                  ×
                </Link>
              </span>
            </div>
          )}

          {error && (
            <div role="alert" className="mb-4 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-500/40 dark:bg-red-950/40 dark:text-red-200">
              {error}
            </div>
          )}

          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <FormField label="Search">
              <input
                className={openInputClass}
                placeholder="Invoice number or customer…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </FormField>
            <FormField label="Status">
              <select className={openInputClass} value={status} onChange={(e) => setStatus(e.target.value as "all" | InvoiceStatus)}>
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="From date">
              <input type="date" className={openInputClass} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </FormField>
            <FormField label="To date">
              <input type="date" className={openInputClass} value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </FormField>
            <FormField label="Min. amount (₹)">
              <input type="number" min="0" className={openInputClass} placeholder="0" value={amountMin} onChange={(e) => setAmountMin(e.target.value)} />
            </FormField>
            <FormField label="Max. amount (₹)">
              <input type="number" min="0" className={openInputClass} placeholder="No limit" value={amountMax} onChange={(e) => setAmountMax(e.target.value)} />
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
