"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { supabase, isConfigured } from "@/lib/supabase";
import type { Company, Customer, Invoice, InvoiceItem, Receipt, ReceiptAllocation } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { IconButton, ActionIcons } from "@/components/IconButton";
import { NotConfigured } from "@/components/NotConfigured";
import { FormField, inputClass } from "@/components/FormField";
import { SearchableSelect } from "@/components/SearchableSelect";
import { LineChart, CHART_COLORS } from "@/components/LineChart";
import { daysOverdue } from "@/components/StatusPill";
import { toast } from "@/components/Toast";
import {
  formatCurrency,
  formatDate,
  formatShortDate,
  todayISO,
  parseISODate,
  todayMidnight,
  addCalendarDays,
  daysBetween,
  toISODate,
} from "@/lib/format";
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

/*
  Customer Statement (ledger): every invoice (a debit, at its full total) and
  every receipt (a credit, at its full amount) for one customer, merged into a
  single chronological ledger. Running balance starts at the customer's
  opening_balance and the last *visible* row's balance is the closing balance
  shown in the summary strip — debits/credits always reconcile to it by
  construction (balance = opening + sum(debits) - sum(credits)).

  Same-day ties are settled by putting the invoice (debit) before the receipt
  (credit), then by document number — a stable, documented secondary sort so
  ledger order never depends on fetch order.

  The date-range filter doesn't re-derive the ledger: it's built once across
  the customer's full history, then the "opening balance" for a range is just
  the running balance of the last entry *before* the range starts (or the
  customer's raw opening_balance if the range starts at/before their first
  transaction). That keeps every number internally consistent for any period
  without a second calculation path.
*/

type DateRangePreset = "thisMonth" | "last30" | "thisQuarter" | "thisYear" | "allTime" | "custom";

interface LedgerEntry {
  id: string;
  date: string;
  particulars: string;
  reference: string;
  debit: number;
  credit: number;
  docNo: string;
  kind: "invoice" | "receipt";
  invoiceId?: string;
  receiptId?: string;
  dueDate?: string;
}

interface LedgerRow extends LedgerEntry {
  balance: number;
}

interface AgingBuckets {
  current: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90plus: number;
}

interface ExportColumn {
  header: string;
  type: "text" | "number" | "currency";
}

function Stat({ label, value, valueClassName }: { label: string; value: string; valueClassName: string }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${valueClassName}`}>{value}</p>
    </div>
  );
}

function StatDivider() {
  return <span className="hidden h-8 w-px bg-slate-200 dark:bg-slate-800 sm:block" />;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

// India's financial year runs April–March, matching the convention the AR
// Ageing report already uses for its own date-preset logic.
function fyStartOf(d: Date): Date {
  const year = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return new Date(year, 3, 1);
}

function fyQuarterStartOf(d: Date): Date {
  const start = fyStartOf(d);
  const monthsSince = (d.getFullYear() - start.getFullYear()) * 12 + (d.getMonth() - start.getMonth());
  return new Date(start.getFullYear(), start.getMonth() + Math.floor(monthsSince / 3) * 3, 1);
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const PRESET_LABELS: Record<Exclude<DateRangePreset, "custom">, string> = {
  thisMonth: "This Month",
  last30: "Last 30 Days",
  thisQuarter: "This Quarter",
  thisYear: "This Year",
  allTime: "All Time",
};

export default function CustomerStatementPage() {
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [receipts, setReceipts] = useState<Receipt[] | null>(null);
  const [allocations, setAllocations] = useState<ReceiptAllocation[] | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");

  const [rangePreset, setRangePreset] = useState<DateRangePreset>("allTime");
  const [dateFrom, setDateFrom] = useState<string | null>(null);
  const [dateTo, setDateTo] = useState<string | null>(null);

  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [itemsCache, setItemsCache] = useState<Record<string, InvoiceItem[]>>({});
  const [itemsLoading, setItemsLoading] = useState<Record<string, boolean>>({});

  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!supabase) return;
    (async () => {
      const [cust, inv, rcpt, alloc, comp] = await Promise.all([
        supabase.from("customers").select("*"),
        supabase.from("invoices").select("*"),
        supabase.from("receipts").select("*"),
        supabase.from("receipt_allocations").select("*"),
        supabase.from("company").select("*").limit(1).single(),
      ]);
      const firstError = cust.error || inv.error || rcpt.error || alloc.error;
      if (firstError) {
        setError(firstError.message);
        return;
      }
      setCustomers(cust.data as Customer[]);
      setInvoices(inv.data as Invoice[]);
      setReceipts(rcpt.data as Receipt[]);
      setAllocations(alloc.data as ReceiptAllocation[]);
      setCompany((comp.data as Company) ?? null);
    })();
  }, []);

  // Seed customer + date range from the URL once on mount, so a shared
  // statement link opens straight to the right view ("Copy Link" keeps the
  // URL in sync as these change, below).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const c = params.get("customer");
    const f = params.get("from");
    const t = params.get("to");
    if (c) setSelectedCustomerId(c);
    if (f || t) {
      setRangePreset("custom");
      setDateFrom(f);
      setDateTo(t);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (selectedCustomerId) url.searchParams.set("customer", selectedCustomerId);
    else url.searchParams.delete("customer");
    if (dateFrom) url.searchParams.set("from", dateFrom);
    else url.searchParams.delete("from");
    if (dateTo) url.searchParams.set("to", dateTo);
    else url.searchParams.delete("to");
    window.history.replaceState(null, "", url.toString());
  }, [selectedCustomerId, dateFrom, dateTo]);

  useEffect(() => {
    if (!exportMenuOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) setExportMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [exportMenuOpen]);

  const loaded = customers && invoices && receipts && allocations;

  const sortedCustomers = useMemo(() => [...(customers ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [customers]);
  const customerOptions = useMemo(
    () => sortedCustomers.map((c) => ({ id: c.id, label: c.name, sublabel: c.code })),
    [sortedCustomers]
  );

  const selectedCustomer = useMemo(
    () => customers?.find((c) => c.id === selectedCustomerId) ?? null,
    [customers, selectedCustomerId]
  );

  // Per-invoice outstanding (total minus its receipt_allocations) — the same
  // rule the AR Ageing report uses. Independent of the selected customer.
  const outstandingByInvoice = useMemo(() => {
    const map = new Map<string, number>();
    if (!invoices || !allocations) return map;
    const allocSum = new Map<string, number>();
    for (const a of allocations) allocSum.set(a.invoice_id, (allocSum.get(a.invoice_id) ?? 0) + a.amount);
    for (const inv of invoices) map.set(inv.id, inv.total - (allocSum.get(inv.id) ?? 0));
    return map;
  }, [invoices, allocations]);

  // Full-history ledger for the selected customer, chronological, running
  // balance from opening_balance. Never filtered by date range — the range
  // filter only changes what's *displayed*, not this base calculation.
  const allRows = useMemo<LedgerRow[]>(() => {
    if (!selectedCustomer || !invoices || !receipts) return [];

    const entries: LedgerEntry[] = [
      ...invoices
        .filter((inv) => inv.customer_id === selectedCustomer.id)
        .map((inv) => ({
          id: `inv-${inv.id}`,
          date: inv.invoice_date,
          particulars: `Invoice ${inv.invoice_no}`,
          reference: inv.invoice_no,
          debit: inv.total,
          credit: 0,
          docNo: inv.invoice_no,
          kind: "invoice" as const,
          invoiceId: inv.id,
          dueDate: inv.due_date,
        })),
      ...receipts
        .filter((r) => r.customer_id === selectedCustomer.id)
        .map((r) => ({
          id: `rcpt-${r.id}`,
          date: r.receipt_date,
          particulars: `Receipt ${r.receipt_no}`,
          reference: r.receipt_no,
          debit: 0,
          credit: r.amount,
          docNo: r.receipt_no,
          kind: "receipt" as const,
          receiptId: r.id,
        })),
    ];

    // Strict date order; same-day ties settle by putting the debit (invoice)
    // before the credit (receipt), then by document number, so the ledger
    // reads deterministically regardless of fetch order.
    entries.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      if (a.kind !== b.kind) return a.kind === "invoice" ? -1 : 1;
      return a.docNo.localeCompare(b.docNo);
    });

    let balance = selectedCustomer.opening_balance;
    return entries.map((e) => {
      balance += e.debit - e.credit;
      return { ...e, balance };
    });
  }, [selectedCustomer, invoices, receipts]);

  const openingBalanceAllTime = selectedCustomer?.opening_balance ?? 0;

  // Index of the first row on/after dateFrom — used to find the balance "as
  // of" the range's start, which is what makes the opening balance correct
  // for any period, not just the customer's all-time opening_balance.
  const rangeStartIndex = useMemo(() => {
    if (!dateFrom) return 0;
    return allRows.findIndex((r) => r.date >= dateFrom);
  }, [allRows, dateFrom]);

  const rangeOpeningBalance = useMemo(() => {
    if (!dateFrom) return openingBalanceAllTime;
    if (rangeStartIndex === -1) return allRows.length > 0 ? allRows[allRows.length - 1].balance : openingBalanceAllTime;
    return rangeStartIndex > 0 ? allRows[rangeStartIndex - 1].balance : openingBalanceAllTime;
  }, [dateFrom, rangeStartIndex, allRows, openingBalanceAllTime]);

  const visibleRows = useMemo(() => {
    return allRows.filter((r) => (!dateFrom || r.date >= dateFrom) && (!dateTo || r.date <= dateTo));
  }, [allRows, dateFrom, dateTo]);

  const totalDebit = useMemo(() => visibleRows.reduce((s, r) => s + r.debit, 0), [visibleRows]);
  const totalCredit = useMemo(() => visibleRows.reduce((s, r) => s + r.credit, 0), [visibleRows]);
  const closingBalance = visibleRows.length > 0 ? visibleRows[visibleRows.length - 1].balance : rangeOpeningBalance;

  const isAmountDue = closingBalance > 0.005;
  const balanceLabel = isAmountDue ? "Amount Due" : "Credit Balance";
  const balanceColorClass = isAmountDue ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400";

  // Outstanding Aging — due-date based (Current = not yet due; then 1–30 /
  // 31–60 / 61–90 / 90+ days past due), the same bucketing the AR Ageing
  // report uses. This is a snapshot of today's exposure, independent of the
  // date-range filter above (aging is about what's owed *now*, not history).
  const aging = useMemo<AgingBuckets>(() => {
    const buckets: AgingBuckets = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 };
    if (!selectedCustomer || !invoices) return buckets;
    const today = todayMidnight();
    for (const inv of invoices) {
      if (inv.customer_id !== selectedCustomer.id) continue;
      const outstanding = outstandingByInvoice.get(inv.id) ?? 0;
      if (outstanding <= 0.005) continue;
      const due = parseISODate(inv.due_date);
      if (due >= today) {
        buckets.current += outstanding;
        continue;
      }
      const daysPastDue = daysBetween(due, today);
      if (daysPastDue <= 30) buckets.d1_30 += outstanding;
      else if (daysPastDue <= 60) buckets.d31_60 += outstanding;
      else if (daysPastDue <= 90) buckets.d61_90 += outstanding;
      else buckets.d90plus += outstanding;
    }
    return buckets;
  }, [selectedCustomer, invoices, outstandingByInvoice]);

  function applyPreset(preset: DateRangePreset) {
    setRangePreset(preset);
    const today = todayMidnight();
    if (preset === "thisMonth") {
      setDateFrom(toISODate(startOfMonth(today)));
      setDateTo(toISODate(today));
    } else if (preset === "last30") {
      setDateFrom(toISODate(addCalendarDays(today, -29)));
      setDateTo(toISODate(today));
    } else if (preset === "thisQuarter") {
      setDateFrom(toISODate(fyQuarterStartOf(today)));
      setDateTo(toISODate(today));
    } else if (preset === "thisYear") {
      setDateFrom(toISODate(fyStartOf(today)));
      setDateTo(toISODate(today));
    } else {
      setDateFrom(null);
      setDateTo(null);
    }
  }

  const rangeLabel = (() => {
    if (rangePreset !== "custom") return PRESET_LABELS[rangePreset];
    if (!dateFrom && !dateTo) return "All Time";
    return `${dateFrom ? formatDate(dateFrom) : "the beginning"} – ${dateTo ? formatDate(dateTo) : "today"}`;
  })();

  async function ensureItemsLoaded(invoiceId: string) {
    if (itemsCache[invoiceId] || itemsLoading[invoiceId] || !supabase) return;
    setItemsLoading((s) => ({ ...s, [invoiceId]: true }));
    const { data } = await supabase.from("invoice_items").select("*").eq("invoice_id", invoiceId).order("id");
    setItemsCache((c) => ({ ...c, [invoiceId]: (data ?? []) as InvoiceItem[] }));
    setItemsLoading((s) => ({ ...s, [invoiceId]: false }));
  }

  function toggleExpand(row: LedgerRow) {
    setExpandedRowId((cur) => (cur === row.id ? null : row.id));
    if (row.kind === "invoice" && row.invoiceId) ensureItemsLoaded(row.invoiceId);
  }

  function handlePrint() {
    setExpandedRowId(null);
    requestAnimationFrame(() => window.print());
  }

  function copyLink() {
    navigator.clipboard.writeText(window.location.href).then(() => toast("Statement link copied"));
  }

  // ---- export: one shared table builder feeding CSV / Excel / PDF -----------

  function buildExportTable(): { title: string; columns: ExportColumn[]; rows: (string | number)[][]; footer: (string | number)[] } {
    const columns: ExportColumn[] = [
      { header: "Date", type: "text" },
      { header: "Particulars", type: "text" },
      { header: "Reference", type: "text" },
      { header: "Debit", type: "currency" },
      { header: "Credit", type: "currency" },
      { header: "Balance", type: "currency" },
    ];
    const rows: (string | number)[][] = [
      ["", "Opening Balance", "", "", "", rangeOpeningBalance],
      ...visibleRows.map((r) => [formatDate(r.date), r.particulars, r.reference, r.debit || "", r.credit || "", r.balance]),
    ];
    const footer = ["", balanceLabel, "", totalDebit, totalCredit, closingBalance];
    const title = `Customer Statement — ${selectedCustomer?.name ?? ""} (${selectedCustomer?.code ?? ""}) — ${rangeLabel}`;
    return { title, columns, rows, footer };
  }

  function exportCsv() {
    const { columns, rows, footer } = buildExportTable();
    const fmt = (v: string | number, type: ExportColumn["type"]) => (type === "currency" && v !== "" ? Number(v).toFixed(2) : String(v));
    const lines = [columns.map((c) => c.header).map(csvCell).join(",")];
    for (const row of rows) lines.push(row.map((v, i) => csvCell(fmt(v, columns[i].type))).join(","));
    lines.push(footer.map((v, i) => csvCell(fmt(v, columns[i].type))).join(","));
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `statement-${selectedCustomer?.code ?? "customer"}-${todayISO()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportXlsx() {
    const { title, columns, rows, footer } = buildExportTable();
    const header = columns.map((c) => c.header);
    const aoa: (string | number)[][] = [[title], [], header, ...rows, footer];
    const sheet = XLSX.utils.aoa_to_sheet(aoa);
    sheet["!cols"] = columns.map((c) => ({ wch: c.header.length < 14 ? 16 : c.header.length + 4 }));
    sheet["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: header.length - 1 } }];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Statement");
    XLSX.writeFile(workbook, `statement-${selectedCustomer?.code ?? "customer"}-${todayISO()}.xlsx`);
  }

  function exportPdf() {
    const { title, columns, rows, footer } = buildExportTable();
    const doc = new jsPDF();
    doc.setFontSize(12);
    doc.text(title, 14, 16);
    const fmt = (v: string | number, type: ExportColumn["type"]) => (type === "currency" && v !== "" ? formatCurrency(Number(v)) : String(v));
    autoTable(doc, {
      startY: 22,
      head: [columns.map((c) => c.header)],
      body: rows.map((row) => row.map((v, i) => fmt(v, columns[i].type))),
      foot: [footer.map((v, i) => fmt(v, columns[i].type))],
      styles: { fontSize: 8 },
      headStyles: { fillColor: [35, 64, 139] },
      footStyles: { fillColor: [238, 242, 250], textColor: [15, 23, 42], fontStyle: "bold" },
    });
    doc.save(`statement-${selectedCustomer?.code ?? "customer"}-${todayISO()}.pdf`);
  }

  const sparklineRows = visibleRows.length > 1 ? visibleRows : [];

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4 print:hidden">
        <PageHeader title="Customer Statement" subtitle="Every invoice and receipt for one customer, in one running account." />
        {isConfigured && selectedCustomer && (
          <div className="flex flex-none flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={copyLink}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Copy Link
            </button>
            <div ref={exportMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setExportMenuOpen((o) => !o)}
                aria-expanded={exportMenuOpen}
                aria-haspopup="menu"
                className="flex items-center gap-1.5 rounded-lg border border-brand px-4 py-2 text-sm font-semibold text-brand transition-all duration-200 hover:bg-brand-50 active:scale-95 dark:border-brand-300 dark:text-brand-300 dark:hover:bg-brand-900/30"
              >
                Export
                <svg
                  className={`h-3.5 w-3.5 transition-transform duration-200 ${exportMenuOpen ? "rotate-180" : ""}`}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              {exportMenuOpen && (
                <div role="menu" className="absolute right-0 z-10 mt-1 w-48 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
                  {[
                    { label: "CSV", action: exportCsv },
                    { label: "Excel (.xlsx)", action: exportXlsx },
                    { label: "PDF", action: exportPdf },
                  ].map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        item.action();
                        setExportMenuOpen(false);
                      }}
                      className="block w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                      Download as {item.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <IconButton label="Print / Save as PDF" variant="primary" onClick={handlePrint}>
              {ActionIcons.print}
            </IconButton>
          </div>
        )}
      </div>

      {/* Print-only header, since the app chrome is hidden when printing */}
      {selectedCustomer && (
        <div className="mb-4 hidden print:block">
          <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
            <div>
              {company && (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/verve-logo-blue.png" alt={company.name} className="mb-2 h-10 w-auto" />
                  <p className="text-sm text-slate-500">{company.address}</p>
                  <p className="text-sm text-slate-500">
                    {company.gstin && `GSTIN ${company.gstin}`} {company.email} {company.phone}
                  </p>
                </>
              )}
            </div>
            <div className="text-right">
              <h1 className="text-lg font-semibold text-slate-800">Customer Statement</h1>
              <p className="text-sm text-slate-500">
                {selectedCustomer.name} ({selectedCustomer.code})
              </p>
              <p className="text-sm text-slate-500">Period: {rangeLabel}</p>
              <p className="text-sm text-slate-500">As of {formatDate(todayISO())}</p>
            </div>
          </div>
        </div>
      )}

      {!isConfigured && <NotConfigured />}

      {isConfigured && error && (
        <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-6 text-red-800 dark:border-red-500/40 dark:bg-red-950/40 dark:text-red-200">
          <p className="font-semibold">Couldn&apos;t load the statement.</p>
          <p className="mt-1 text-sm">{error}</p>
        </div>
      )}

      {isConfigured && !error && !loaded && (
        <div className="animate-pulse space-y-4">
          <div className="h-10 w-full max-w-sm rounded-lg bg-slate-100 dark:bg-slate-800/60" />
          <div className="h-16 w-full rounded-xl bg-slate-100 dark:bg-slate-800/60" />
          <div className="h-64 w-full rounded-xl bg-slate-100 dark:bg-slate-800/60" />
        </div>
      )}

      {isConfigured && !error && loaded && (
        <>
          <div className="mb-4 max-w-sm print:hidden">
            <FormField label="Customer">
              <SearchableSelect options={customerOptions} value={selectedCustomerId} onChange={setSelectedCustomerId} placeholder="Search customers…" />
            </FormField>
          </div>

          {!selectedCustomer && (
            <div className="py-10 text-center text-sm text-slate-400 dark:text-slate-500 print:hidden">
              Select a customer to view their statement.
            </div>
          )}

          {selectedCustomer && (
            <>
              {/* Date range filter */}
              <div className="mb-6 flex flex-wrap items-center gap-2 print:hidden">
                {(Object.keys(PRESET_LABELS) as (keyof typeof PRESET_LABELS)[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => applyPreset(key)}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                      rangePreset === key
                        ? "bg-brand text-white"
                        : "border border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                    }`}
                  >
                    {PRESET_LABELS[key]}
                  </button>
                ))}
                <span className="hidden h-6 w-px bg-slate-200 dark:bg-slate-800 sm:block" />
                <input
                  type="date"
                  aria-label="From date"
                  className={`${inputClass} w-auto text-xs`}
                  value={dateFrom ?? ""}
                  max={todayISO()}
                  onChange={(e) => {
                    setDateFrom(e.target.value || null);
                    setRangePreset("custom");
                  }}
                />
                <span className="text-xs text-slate-400 dark:text-slate-500">to</span>
                <input
                  type="date"
                  aria-label="To date"
                  className={`${inputClass} w-auto text-xs`}
                  value={dateTo ?? ""}
                  max={todayISO()}
                  onChange={(e) => {
                    setDateTo(e.target.value || null);
                    setRangePreset("custom");
                  }}
                />
              </div>

              {/* Summary strip */}
              <div className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-4">
                <div>
                  <p className="font-semibold text-slate-800 dark:text-slate-100">{selectedCustomer.name}</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500">
                    {selectedCustomer.code} · {rangeLabel}
                  </p>
                </div>
                <StatDivider />
                <Stat label="Opening Balance" value={formatCurrency(rangeOpeningBalance)} valueClassName="text-slate-800 dark:text-slate-100" />
                <StatDivider />
                <Stat label="Total Debits (Invoiced)" value={formatCurrency(totalDebit)} valueClassName="text-slate-800 dark:text-slate-100" />
                <StatDivider />
                <Stat label="Total Credits (Received)" value={formatCurrency(totalCredit)} valueClassName="text-slate-800 dark:text-slate-100" />
                <StatDivider />
                <Stat label={balanceLabel} value={formatCurrency(closingBalance)} valueClassName={balanceColorClass} />
              </div>

              {/* Balance trend sparkline */}
              {sparklineRows.length > 0 && (
                <div className="mb-6 print:hidden">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Balance Trend</h3>
                  <LineChart
                    labels={sparklineRows.map((r) => formatShortDate(r.date))}
                    series={[{ name: "Running Balance", values: sparklineRows.map((r) => r.balance), color: CHART_COLORS.blue }]}
                    height={120}
                  />
                </div>
              )}

              {/* Ledger table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-left dark:border-slate-800 dark:bg-brand-950 dark:print:border-slate-200 dark:print:bg-slate-50">
                      <th className="whitespace-nowrap px-4 py-3 font-semibold text-slate-600 dark:text-slate-300 dark:print:text-slate-600">Date</th>
                      <th className="whitespace-nowrap px-4 py-3 font-semibold text-slate-600 dark:text-slate-300 dark:print:text-slate-600">Particulars</th>
                      <th className="whitespace-nowrap px-4 py-3 font-semibold text-slate-600 dark:text-slate-300 dark:print:text-slate-600">Reference</th>
                      <th className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-600 dark:text-slate-300 dark:print:text-slate-600">Debit</th>
                      <th className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-600 dark:text-slate-300 dark:print:text-slate-600">Credit</th>
                      <th className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-600 dark:text-slate-300 dark:print:text-slate-600">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-slate-100 dark:border-slate-800 dark:print:border-slate-100">
                      <td className="px-4 py-3 text-slate-400 dark:text-slate-500 dark:print:text-slate-400">—</td>
                      <td className="px-4 py-3 font-medium italic text-slate-500 dark:text-slate-400 dark:print:text-slate-500">Opening Balance</td>
                      <td className="px-4 py-3 text-slate-400 dark:text-slate-500 dark:print:text-slate-400">–</td>
                      <td className="px-4 py-3 text-right text-slate-400 dark:text-slate-500 dark:print:text-slate-400">–</td>
                      <td className="px-4 py-3 text-right text-slate-400 dark:text-slate-500 dark:print:text-slate-400">–</td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium text-slate-700 dark:text-slate-300 dark:print:text-slate-700">
                        {formatCurrency(rangeOpeningBalance)}
                      </td>
                    </tr>
                    {visibleRows.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-10 text-center text-slate-400 dark:text-slate-500 dark:print:text-slate-400">
                          No transactions in this period.
                        </td>
                      </tr>
                    ) : (
                      visibleRows.map((r) => {
                        const isOverdueInvoice =
                          r.kind === "invoice" &&
                          r.invoiceId != null &&
                          r.dueDate != null &&
                          (outstandingByInvoice.get(r.invoiceId) ?? 0) > 0.005 &&
                          parseISODate(r.dueDate) < todayMidnight();
                        const expanded = expandedRowId === r.id;
                        return (
                          <Fragment key={r.id}>
                            <tr
                              className={`border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50 dark:print:border-slate-100 ${
                                r.kind === "receipt" ? "bg-emerald-50/40 dark:bg-emerald-900/10" : ""
                              }`}
                            >
                              <td className="whitespace-nowrap px-4 py-3 text-slate-700 dark:text-slate-300 dark:print:text-slate-700">{formatDate(r.date)}</td>
                              <td className="px-4 py-3 text-slate-700 dark:text-slate-300 dark:print:text-slate-700">
                                {r.particulars}
                                {isOverdueInvoice && r.dueDate && (
                                  <span className="ml-2 inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-700 dark:bg-red-900/40 dark:text-red-300">
                                    Overdue {daysOverdue(r.dueDate)}d
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                <button
                                  type="button"
                                  onClick={() => toggleExpand(r)}
                                  className="flex items-center gap-1 text-brand hover:underline dark:text-brand-300 print:text-slate-700 print:no-underline"
                                >
                                  <svg
                                    className={`h-3 w-3 flex-none transition-transform duration-150 print:hidden ${expanded ? "rotate-90" : ""}`}
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="3"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  >
                                    <polyline points="9 18 15 12 9 6" />
                                  </svg>
                                  {r.reference}
                                </button>
                              </td>
                              <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-700 dark:text-slate-300 dark:print:text-slate-700">
                                {r.debit > 0 ? formatCurrency(r.debit) : "–"}
                              </td>
                              <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-emerald-700 dark:text-emerald-400 dark:print:text-slate-700">
                                {r.credit > 0 ? formatCurrency(r.credit) : "–"}
                              </td>
                              <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums font-medium text-slate-700 dark:text-slate-300 dark:print:text-slate-700">
                                {formatCurrency(r.balance)}
                              </td>
                            </tr>
                            {expanded && (
                              <tr className="border-b border-slate-100 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-800/30 print:hidden">
                                <td colSpan={6} className="px-4 py-4">
                                  {r.kind === "invoice" && r.invoiceId && (
                                    <InvoiceDetail invoiceId={r.invoiceId} items={itemsCache[r.invoiceId]} loading={Boolean(itemsLoading[r.invoiceId])} />
                                  )}
                                  {r.kind === "receipt" && r.receiptId && (
                                    <ReceiptDetail
                                      receipt={(receipts ?? []).find((rc) => rc.id === r.receiptId)!}
                                      allocations={(allocations ?? []).filter((a) => a.receipt_id === r.receiptId)}
                                      invoices={invoices ?? []}
                                    />
                                  )}
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })
                    )}
                    <tr className="border-t border-slate-300 font-semibold dark:border-slate-700 dark:print:border-slate-300">
                      <td className="px-4 py-3 text-slate-800 dark:text-slate-100 dark:print:text-slate-800" colSpan={3}>
                        {balanceLabel}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-800 dark:text-slate-100 dark:print:text-slate-800">
                        {formatCurrency(totalDebit)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-800 dark:text-slate-100 dark:print:text-slate-800">
                        {formatCurrency(totalCredit)}
                      </td>
                      <td className={`whitespace-nowrap px-4 py-3 text-right tabular-nums dark:print:text-slate-800 ${balanceColorClass}`}>
                        {formatCurrency(closingBalance)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Outstanding aging summary */}
              <div className="mt-8 border-t border-slate-200 pt-6 dark:border-slate-800">
                <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Outstanding Aging Summary{" "}
                  <span className="font-normal normal-case text-slate-400 dark:text-slate-500">— as of {formatDate(todayISO())}</span>
                </h3>
                <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
                  <Stat label="Current" value={formatCurrency(aging.current)} valueClassName="text-slate-800 dark:text-slate-100" />
                  <StatDivider />
                  <Stat label="1–30 days" value={formatCurrency(aging.d1_30)} valueClassName="text-amber-600 dark:text-amber-400" />
                  <StatDivider />
                  <Stat label="31–60 days" value={formatCurrency(aging.d31_60)} valueClassName="text-orange-600 dark:text-orange-400" />
                  <StatDivider />
                  <Stat label="61–90 days" value={formatCurrency(aging.d61_90)} valueClassName="text-red-600 dark:text-red-400" />
                  <StatDivider />
                  <Stat label="90+ days" value={formatCurrency(aging.d90plus)} valueClassName="text-red-700 dark:text-red-500" />
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function InvoiceDetail({ invoiceId, items, loading }: { invoiceId: string; items: InvoiceItem[] | undefined; loading: boolean }) {
  if (loading || !items) {
    return <p className="text-xs text-slate-400 dark:text-slate-500">Loading line items…</p>;
  }
  const subtotal = items.reduce((s, i) => s + i.amount, 0);
  return (
    <div className="max-w-2xl">
      {items.length === 0 ? (
        <p className="text-xs text-slate-400 dark:text-slate-500">No line items recorded.</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500 dark:border-slate-700 dark:text-slate-400">
              <th className="py-1.5 font-medium">Description</th>
              <th className="py-1.5 text-right font-medium">Qty</th>
              <th className="py-1.5 text-right font-medium">Rate</th>
              <th className="py-1.5 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                <td className="py-1.5 text-slate-700 dark:text-slate-300">{it.description}</td>
                <td className="py-1.5 text-right tabular-nums text-slate-700 dark:text-slate-300">{it.qty}</td>
                <td className="py-1.5 text-right tabular-nums text-slate-700 dark:text-slate-300">{formatCurrency(it.rate)}</td>
                <td className="py-1.5 text-right tabular-nums text-slate-700 dark:text-slate-300">{formatCurrency(it.amount)}</td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td className="py-1.5 text-slate-700 dark:text-slate-300" colSpan={3}>
                Subtotal
              </td>
              <td className="py-1.5 text-right tabular-nums text-slate-700 dark:text-slate-300">{formatCurrency(subtotal)}</td>
            </tr>
          </tbody>
        </table>
      )}
      <Link href={`/invoices/${invoiceId}`} className="mt-2 inline-block text-xs font-medium text-brand hover:underline dark:text-brand-300">
        Open full invoice →
      </Link>
    </div>
  );
}

function ReceiptDetail({ receipt, allocations, invoices }: { receipt: Receipt; allocations: ReceiptAllocation[]; invoices: Invoice[] }) {
  const invoiceById = new Map(invoices.map((i) => [i.id, i]));
  return (
    <div className="max-w-2xl text-xs">
      <div className="mb-2 flex flex-wrap gap-x-6 gap-y-1 text-slate-600 dark:text-slate-300">
        <span>
          <span className="text-slate-400 dark:text-slate-500">Mode:</span> <span className="capitalize">{receipt.mode}</span>
        </span>
        <span>
          <span className="text-slate-400 dark:text-slate-500">Reference:</span> {receipt.reference || "—"}
        </span>
      </div>
      {allocations.length === 0 ? (
        <p className="text-slate-400 dark:text-slate-500">Not yet allocated to an invoice.</p>
      ) : (
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500 dark:border-slate-700 dark:text-slate-400">
              <th className="py-1.5 font-medium">Applied To</th>
              <th className="py-1.5 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {allocations.map((a) => (
              <tr key={a.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                <td className="py-1.5 text-slate-700 dark:text-slate-300">{invoiceById.get(a.invoice_id)?.invoice_no ?? "—"}</td>
                <td className="py-1.5 text-right tabular-nums text-slate-700 dark:text-slate-300">{formatCurrency(a.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
