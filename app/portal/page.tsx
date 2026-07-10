"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, isConfigured } from "@/lib/supabase";
import { customerSignOut } from "@/lib/customerAuth";
import { NotConfigured } from "@/components/NotConfigured";
import { DataTable, type Column } from "@/components/DataTable";
import { ExportButton } from "@/components/ExportButton";
import { StatusBadge } from "@/components/StatusBadge";
import { ThemeToggle } from "@/components/ThemeToggle";
import { toast, Toaster } from "@/components/Toast";
import { formatCurrency, formatDate, todayISO } from "@/lib/format";
import { downloadCsv } from "@/lib/csv";
import { buildAllocationMap, paidAmount, balanceDue, displayStatus } from "@/lib/invoice";
import { daysOverdue } from "@/components/StatusPill";
import type { Customer, Invoice, ReceiptAllocation } from "@/lib/types";

/*
  Customer-facing "My Invoices" — read-only data (no edit/delete), but with
  UI hooks for actions a customer would actually take: paying and downloading
  an invoice. A customer is linked to their `customers` row purely by
  matching Supabase Auth email (see lib/customerAuth.ts). The query below
  asks for ALL customers/invoices, but Postgres RLS
  (supabase/migrations/002_customer_login_rls.sql) is what actually narrows
  the result to just their own row(s) — this app-level shape is a
  convenience, not the security boundary. No links to any internal screen,
  no nav — this page is the entire app for a customer session.
*/

type StatusFilter = "all" | "open" | "overdue" | "paid";

interface InvoiceRow {
  id: string;
  invoice_no: string;
  invoice_date: string;
  due_date: string;
  total: number;
  balance: number;
  status: Invoice["status"];
}

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function StatCard({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "red" }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${tone === "red" ? "text-red-600 dark:text-red-400" : "text-brand dark:text-white"}`}>
        {value}
      </p>
    </div>
  );
}

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "overdue", label: "Overdue" },
  { key: "paid", label: "Paid" },
];

export default function CustomerPortalPage() {
  const router = useRouter();
  const [customer, setCustomer] = useState<Customer | null | undefined>(undefined); // undefined = loading, null = none found
  const [rows, setRows] = useState<InvoiceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        router.replace("/signin");
        return;
      }

      const { data: custRows, error: custErr } = await supabase.from("customers").select("*").limit(1);
      if (custErr) {
        if (!cancelled) setError(custErr.message);
        return;
      }
      const me = (custRows ?? [])[0] as Customer | undefined;
      if (!me) {
        if (!cancelled) setCustomer(null);
        return;
      }
      if (!cancelled) setCustomer(me);

      const [{ data: invoices, error: invErr }, { data: allocations, error: allocErr }] = await Promise.all([
        supabase.from("invoices").select("*").eq("customer_id", me.id),
        supabase.from("receipt_allocations").select("*"),
      ]);
      if (invErr || allocErr) {
        if (!cancelled) setError(invErr?.message || allocErr?.message || "Failed to load invoices.");
        return;
      }

      const allocationMap = buildAllocationMap((allocations ?? []) as ReceiptAllocation[]);
      const built: InvoiceRow[] = ((invoices ?? []) as Invoice[]).map((inv) => {
        const paid = paidAmount(inv.id, allocationMap);
        return {
          id: inv.id,
          invoice_no: inv.invoice_no,
          invoice_date: inv.invoice_date,
          due_date: inv.due_date,
          total: inv.total,
          balance: balanceDue(inv, paid),
          status: displayStatus(inv),
        };
      });

      if (!cancelled) setRows(built);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function handleSignOut() {
    await customerSignOut();
    router.replace("/signin");
  }

  // ---- 1. Summary bar --------------------------------------------------
  const totalOutstanding = (rows ?? []).filter((r) => r.status !== "paid").reduce((s, r) => s + r.balance, 0);
  const totalOverdue = (rows ?? []).filter((r) => r.status === "overdue").reduce((s, r) => s + r.balance, 0);
  const openCount = (rows ?? []).filter((r) => r.status === "open").length;

  // ---- 2. Status filter tabs --------------------------------------------
  const tabCounts: Record<StatusFilter, number> = {
    all: (rows ?? []).length,
    open: (rows ?? []).filter((r) => r.status === "open").length,
    overdue: (rows ?? []).filter((r) => r.status === "overdue").length,
    paid: (rows ?? []).filter((r) => r.status === "paid").length,
  };
  const filteredRows = useMemo(
    () => (rows ?? []).filter((r) => statusFilter === "all" || r.status === statusFilter),
    [rows, statusFilter]
  );

  // ---- 3. Pay Now / Pay Selected (placeholder — no payment processing yet) ----
  function handlePayNow(row: InvoiceRow) {
    console.log("Pay Now clicked for invoice", row.id, row.invoice_no);
    toast("Payment flow coming soon", "info");
  }
  function handlePaySelected() {
    console.log("Pay Selected clicked for invoices", Array.from(selectedIds));
    toast("Payment flow coming soon", "info");
  }
  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const payableFilteredRows = filteredRows.filter((r) => r.balance > 0.005);
  const allFilteredSelected = payableFilteredRows.length > 0 && payableFilteredRows.every((r) => selectedIds.has(r.id));
  function toggleSelectAllFiltered() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        payableFilteredRows.forEach((r) => next.delete(r.id));
      } else {
        payableFilteredRows.forEach((r) => next.add(r.id));
      }
      return next;
    });
  }
  const selectedRows = (rows ?? []).filter((r) => selectedIds.has(r.id));
  const selectedTotal = selectedRows.reduce((s, r) => s + r.balance, 0);

  // ---- 4. Download invoice / Export CSV (placeholders / client-side CSV) ----
  function downloadInvoice(invoiceId: string) {
    console.log("Download invoice", invoiceId);
    toast("Invoice download coming soon", "info");
  }
  function handleExportCsv() {
    downloadCsv(
      `my-invoices-${todayISO()}.csv`,
      ["Invoice Number", "Invoice Date", "Due Date", "Amount", "Balance", "Status"],
      filteredRows.map((r) => [r.invoice_no, formatDate(r.invoice_date), formatDate(r.due_date), r.total.toFixed(2), r.balance.toFixed(2), r.status])
    );
  }

  const columns: Column<InvoiceRow>[] = [
    {
      key: "select",
      header: "",
      sortable: false,
      className: "w-8",
      render: (r) =>
        r.balance > 0.005 ? (
          <input
            type="checkbox"
            checked={selectedIds.has(r.id)}
            onChange={() => toggleSelected(r.id)}
            onClick={(e) => e.stopPropagation()}
            className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand dark:border-slate-700"
            aria-label={`Select invoice ${r.invoice_no}`}
          />
        ) : null,
    },
    { key: "invoice_no", header: "Invoice Number", className: "whitespace-nowrap font-medium text-slate-800 dark:text-slate-100" },
    { key: "invoice_date", header: "Invoice Date", className: "whitespace-nowrap", render: (r) => formatDate(r.invoice_date) },
    { key: "due_date", header: "Due Date", className: "whitespace-nowrap", render: (r) => formatDate(r.due_date) },
    { key: "total", header: "Amount", className: "whitespace-nowrap text-right", render: (r) => formatCurrency(r.total) },
    {
      key: "balance",
      header: "Balance",
      className: "whitespace-nowrap text-right",
      render: (r) => (
        <span className={r.balance > 0.005 ? "font-medium text-red-600 dark:text-red-400" : ""}>{formatCurrency(r.balance)}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      className: "whitespace-nowrap",
      render: (r) => (
        <div className="flex flex-col gap-0.5">
          <StatusBadge status={r.status} />
          {r.status === "overdue" && <span className="text-[11px] text-red-500 dark:text-red-400">{daysOverdue(r.due_date)}d overdue</span>}
        </div>
      ),
    },
    {
      key: "actions",
      header: "",
      sortable: false,
      className: "whitespace-nowrap text-right",
      render: (r) => (
        <div className="flex items-center justify-end gap-2">
          {r.balance > 0.005 && (
            <button
              type="button"
              onClick={() => handlePayNow(r)}
              className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-700"
            >
              Pay Now
            </button>
          )}
          <button
            type="button"
            onClick={() => downloadInvoice(r.id)}
            aria-label={`Download invoice ${r.invoice_no}`}
            title="Download invoice"
            className="rounded-lg border border-slate-300 p-1.5 text-slate-500 transition-colors hover:border-brand hover:text-brand dark:border-slate-700 dark:text-slate-400 dark:hover:border-brand-400 dark:hover:text-brand-300"
          >
            <DownloadIcon className="h-4 w-4" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-3">
          <img src="/verve-logo-blue.png" alt="Verve Advisory" className="h-7 w-auto dark:hidden" />
          <img src="/verve-logo-white.png" alt="Verve Advisory" className="hidden h-7 w-auto dark:block" />
          <span className="text-xs font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">Customer Portal</span>
        </div>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <button
            onClick={handleSignOut}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl p-8">
        {!isConfigured && <NotConfigured />}

        {isConfigured && (
          <>
            <h1 className="text-2xl font-bold text-brand dark:text-white">My Invoices</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {customer ? `Every invoice billed to ${customer.name}.` : "Everything currently billed to your account."}
            </p>

            {error && (
              <div className="mt-4 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-500/40 dark:bg-red-950/40 dark:text-red-200">
                {error}
              </div>
            )}

            {customer === null && !error && (
              <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-6 text-amber-800 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-200">
                <p className="font-semibold">No customer account is linked to this login.</p>
                <p className="mt-1 text-sm">
                  Your email doesn&apos;t match any customer on file. Contact Verve Advisory to get your account set up, or sign out and
                  try a different email.
                </p>
              </div>
            )}

            {customer && !error && (
              <>
                {/* 1. Summary bar */}
                <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <StatCard label="Total Outstanding" value={formatCurrency(totalOutstanding)} />
                  <StatCard label="Total Overdue" value={formatCurrency(totalOverdue)} tone="red" />
                  <StatCard label="Open Invoices" value={String(openCount)} />
                </div>

                {/* 2. Status filter tabs */}
                <div className="mt-6 flex flex-wrap gap-2">
                  {STATUS_TABS.map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setStatusFilter(tab.key)}
                      className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                        statusFilter === tab.key
                          ? "bg-brand text-white"
                          : "border border-slate-300 text-slate-600 hover:border-brand hover:text-brand dark:border-slate-700 dark:text-slate-300 dark:hover:border-brand-400 dark:hover:text-brand-300"
                      }`}
                    >
                      {tab.label} ({tabCounts[tab.key]})
                    </button>
                  ))}
                </div>

                {/* 3. Bulk "Pay Selected" bar */}
                {selectedRows.length > 0 && (
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand/30 bg-brand-50 px-4 py-3 dark:border-brand-400/30 dark:bg-brand-900/20">
                    <span className="text-sm font-medium text-brand dark:text-brand-200">
                      {selectedRows.length} invoice{selectedRows.length === 1 ? "" : "s"} selected
                    </span>
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-2 text-xs text-brand/80 dark:text-brand-200/80">
                        <input
                          type="checkbox"
                          checked={allFilteredSelected}
                          onChange={toggleSelectAllFiltered}
                          className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand dark:border-slate-700"
                        />
                        Select all in view
                      </label>
                      <button
                        type="button"
                        onClick={handlePaySelected}
                        className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
                      >
                        Pay Selected ({formatCurrency(selectedTotal)})
                      </button>
                    </div>
                  </div>
                )}

                <div className="mt-6">
                  {rows === null ? (
                    <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>
                  ) : (
                    <DataTable
                      columns={columns}
                      rows={filteredRows}
                      empty="No invoices match this filter."
                      toolbar={<ExportButton onClick={handleExportCsv} label="Export CSV" />}
                    />
                  )}
                </div>
              </>
            )}
          </>
        )}
      </main>

      {/* AuthGate normally mounts this for internal routes — the portal bypasses
          AuthGate's shell entirely, so it needs its own instance. */}
      <Toaster />
    </div>
  );
}
