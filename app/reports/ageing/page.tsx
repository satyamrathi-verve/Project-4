"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase, isConfigured } from "@/lib/supabase";
import type { Customer, Invoice, Receipt, ReceiptAllocation } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { FormField, inputClass } from "@/components/FormField";
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

/*
  AR Ageing report: for each customer, take invoices outstanding as of a chosen
  date, and bucket the outstanding amount by (as-of date - due date).

  Accuracy note: rather than trusting the invoices.status flag (which reflects
  today's state, not any arbitrary as-of date), outstanding is always derived
  from first principles — total minus every receipt allocation whose receipt
  was dated on/before the as-of date. That makes the report correct for a
  historical as-of date too, not just "today".

  "Location" isn't a column in the schema — it's derived from the first two
  digits of each customer's GSTIN, which is the standard Indian GST state
  code. That's real structured data already sitting in `customers.gstin`,
  not a guess from the free-text address.
*/
type Bucket = "notDue" | "d0_30" | "d31_60" | "d61_90" | "d90plus";
type SortKey = "name" | "state" | "creditLimit" | "total" | Bucket;
type SortDir = "asc" | "desc";
type ExportTemplate = "summary" | "detailed" | "location";

interface AgeingRow {
  id: string;
  code: string;
  name: string;
  state: string;
  creditLimit: number;
  overLimit: boolean;
  notDue: number;
  d0_30: number;
  d31_60: number;
  d61_90: number;
  d90plus: number;
  total: number;
}

interface OutstandingLine {
  invoiceId: string;
  invoiceNo: string;
  customerId: string;
  customerCode: string;
  customerName: string;
  state: string;
  invoiceDate: string;
  dueDate: string;
  daysOverdue: number;
  bucket: Bucket;
  outstanding: number;
}

interface LocationRow {
  state: string;
  customerCount: number;
  notDue: number;
  d0_30: number;
  d31_60: number;
  d61_90: number;
  d90plus: number;
  total: number;
}

interface ExportColumn {
  header: string;
  type: "text" | "number" | "currency";
}

const BUCKET_COLS: { key: Bucket; header: string }[] = [
  { key: "notDue", header: "Not Due" },
  { key: "d0_30", header: "0–30 days" },
  { key: "d31_60", header: "31–60 days" },
  { key: "d61_90", header: "61–90 days" },
  { key: "d90plus", header: "90+ days" },
];

const EXPORT_TEMPLATES: { key: ExportTemplate; label: string; hint: string }[] = [
  { key: "summary", label: "Summary (by customer)", hint: "One row per customer, bucketed." },
  { key: "detailed", label: "Detailed (by invoice)", hint: "One row per outstanding invoice." },
  { key: "location", label: "By location", hint: "One row per state, bucketed." },
];

const EMPTY_BUCKETS = { notDue: 0, d0_30: 0, d31_60: 0, d61_90: 0, d90plus: 0, total: 0 };

// Indian GST state codes — first two digits of a GSTIN identify the state it was issued in.
const GST_STATE_CODES: Record<string, string> = {
  "01": "Jammu & Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh",
  "05": "Uttarakhand", "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh",
  "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur",
  "15": "Mizoram", "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal",
  "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat",
  "25": "Daman & Diu", "26": "Dadra & Nagar Haveli", "27": "Maharashtra", "28": "Andhra Pradesh (Old)",
  "29": "Karnataka", "30": "Goa", "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu",
  "34": "Puducherry", "35": "Andaman & Nicobar Islands", "36": "Telangana", "37": "Andhra Pradesh",
  "38": "Ladakh",
};

function stateFromGstin(gstin: string | null): string {
  if (!gstin || gstin.length < 2) return "Unknown";
  return GST_STATE_CODES[gstin.slice(0, 2)] ?? "Unknown";
}

function toDateOnly(d: string | Date) {
  return new Date((typeof d === "string" ? d : d.toISOString()).slice(0, 10) + "T00:00:00");
}

function addDays(d: Date, days: number) {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function bucketFor(dueDate: string, asOf: Date): Bucket {
  const due = toDateOnly(dueDate);
  if (due >= asOf) return "notDue";
  const daysPastDue = Math.floor((asOf.getTime() - due.getTime()) / 86400000);
  if (daysPastDue <= 30) return "d0_30";
  if (daysPastDue <= 60) return "d31_60";
  if (daysPastDue <= 90) return "d61_90";
  return "d90plus";
}

function formatCurrency(n: number) {
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function csvCell(v: string | number) {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function AgeingReportPage() {
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [receipts, setReceipts] = useState<Receipt[] | null>(null);
  const [allocations, setAllocations] = useState<ReceiptAllocation[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [asOfDate, setAsOfDate] = useState(todayISO());
  const [search, setSearch] = useState("");
  const [locationFilter, setLocationFilter] = useState("all");
  const [bucketFilter, setBucketFilter] = useState<"all" | Bucket>("all");
  const [minOutstanding, setMinOutstanding] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [overLimitOnly, setOverLimitOnly] = useState(false);

  const [visibleBuckets, setVisibleBuckets] = useState<Record<Bucket, boolean>>({
    notDue: true, d0_30: true, d31_60: true, d61_90: true, d90plus: true,
  });
  const [showLocationCol, setShowLocationCol] = useState(true);
  const [showCreditLimitCol, setShowCreditLimitCol] = useState(false);

  const [sortKey, setSortKey] = useState<SortKey>("total");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const [exportTemplate, setExportTemplate] = useState<ExportTemplate>("summary");

  useEffect(() => {
    if (!supabase) return;
    (async () => {
      const [cust, inv, rcpt, alloc] = await Promise.all([
        supabase.from("customers").select("*"),
        supabase.from("invoices").select("*"),
        supabase.from("receipts").select("*"),
        supabase.from("receipt_allocations").select("*"),
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
    })();
  }, []);

  const loaded = customers && invoices && receipts && allocations;

  const customerIndex = useMemo(() => {
    const map = new Map<string, Customer & { state: string }>();
    for (const c of customers ?? []) map.set(c.id, { ...c, state: stateFromGstin(c.gstin) });
    return map;
  }, [customers]);

  const locations = useMemo(() => {
    const set = new Set<string>();
    for (const c of customerIndex.values()) set.add(c.state);
    return Array.from(set).sort();
  }, [customerIndex]);

  // One row per outstanding invoice as of `asOfDate` — the shared source of truth
  // that every view (customer summary, location summary, invoice-level export) rolls up from.
  const lines = useMemo<OutstandingLine[]>(() => {
    if (!loaded) return [];
    const asOf = toDateOnly(asOfDate);

    const receiptDateById = new Map(receipts!.map((r) => [r.id, r.receipt_date]));
    const allocatedAsOf = new Map<string, number>();
    for (const a of allocations!) {
      const rDate = receiptDateById.get(a.receipt_id);
      if (!rDate || toDateOnly(rDate) > asOf) continue;
      allocatedAsOf.set(a.invoice_id, (allocatedAsOf.get(a.invoice_id) ?? 0) + a.amount);
    }

    const result: OutstandingLine[] = [];
    for (const inv of invoices!) {
      if (toDateOnly(inv.invoice_date) > asOf) continue; // didn't exist yet as of this date
      const outstanding = inv.total - (allocatedAsOf.get(inv.id) ?? 0);
      if (outstanding <= 0.005) continue;
      const cust = customerIndex.get(inv.customer_id);
      if (!cust) continue;
      const due = toDateOnly(inv.due_date);
      const daysOverdue = due >= asOf ? 0 : Math.floor((asOf.getTime() - due.getTime()) / 86400000);
      result.push({
        invoiceId: inv.id,
        invoiceNo: inv.invoice_no,
        customerId: cust.id,
        customerCode: cust.code,
        customerName: cust.name,
        state: cust.state,
        invoiceDate: inv.invoice_date,
        dueDate: inv.due_date,
        daysOverdue,
        bucket: bucketFor(inv.due_date, asOf),
        outstanding,
      });
    }
    return result;
  }, [loaded, invoices, receipts, allocations, customerIndex, asOfDate]);

  // Per-customer summary — the primary on-screen view.
  const summaryRows = useMemo<AgeingRow[]>(() => {
    const byCustomer = new Map<string, AgeingRow>();
    for (const l of lines) {
      let row = byCustomer.get(l.customerId);
      if (!row) {
        const cust = customerIndex.get(l.customerId)!;
        row = { id: cust.id, code: cust.code, name: cust.name, state: cust.state, creditLimit: cust.credit_limit, overLimit: false, ...EMPTY_BUCKETS };
        byCustomer.set(l.customerId, row);
      }
      row[l.bucket] += l.outstanding;
      row.total += l.outstanding;
    }
    for (const row of byCustomer.values()) {
      row.overLimit = row.creditLimit > 0 && row.total > row.creditLimit;
    }
    return Array.from(byCustomer.values());
  }, [lines, customerIndex]);

  // "Identity" filters — who the customer is, not how much they owe — used both
  // for the on-screen table and to scope the DSO/KPI portfolio segment below.
  const identityFilteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return summaryRows.filter((r) => {
      if (q && !r.name.toLowerCase().includes(q) && !r.code.toLowerCase().includes(q)) return false;
      if (locationFilter !== "all" && r.state !== locationFilter) return false;
      return true;
    });
  }, [summaryRows, search, locationFilter]);

  const filteredRows = useMemo(() => {
    const min = minOutstanding === "" ? 0 : Number(minOutstanding);
    return identityFilteredRows.filter((r) => {
      if (bucketFilter !== "all" && r[bucketFilter] <= 0.005) return false;
      if (r.total < min) return false;
      if (overdueOnly && r.total - r.notDue <= 0.005) return false;
      if (overLimitOnly && !r.overLimit) return false;
      return true;
    });
  }, [identityFilteredRows, bucketFilter, minOutstanding, overdueOnly, overLimitOnly]);

  const sortedRows = useMemo(() => {
    const arr = [...filteredRows];
    arr.sort((a, b) => {
      let cmp: number;
      if (sortKey === "name" || sortKey === "state") cmp = a[sortKey].localeCompare(b[sortKey]);
      else cmp = a[sortKey] - b[sortKey];
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [filteredRows, sortKey, sortDir]);

  const grandTotal = useMemo(() => {
    const t = { ...EMPTY_BUCKETS };
    for (const r of filteredRows) {
      t.notDue += r.notDue;
      t.d0_30 += r.d0_30;
      t.d31_60 += r.d31_60;
      t.d61_90 += r.d61_90;
      t.d90plus += r.d90plus;
      t.total += r.total;
    }
    return t;
  }, [filteredRows]);

  const overLimitCount = useMemo(() => filteredRows.filter((r) => r.overLimit).length, [filteredRows]);

  // DSO (trailing 90 days) for the current location/search segment — the standard
  // AR health metric: outstanding receivables ÷ recent credit sales × window days.
  // Scoped to identity filters only, so bucket/min/overdue drill-downs don't skew it.
  const dso = useMemo(() => {
    if (!loaded) return null;
    const asOf = toDateOnly(asOfDate);
    const windowStart = addDays(asOf, -89);
    // A customer can be in the segment with zero *current* balance (e.g. fully paid);
    // scope by identity filters against all customers, not just those owing money.
    const segmentIds = new Set(
      Array.from(customerIndex.values())
        .filter((c) => {
          const q = search.trim().toLowerCase();
          if (q && !c.name.toLowerCase().includes(q) && !c.code.toLowerCase().includes(q)) return false;
          if (locationFilter !== "all" && c.state !== locationFilter) return false;
          return true;
        })
        .map((c) => c.id)
    );
    const creditSales90 = invoices!
      .filter((inv) => segmentIds.has(inv.customer_id))
      .filter((inv) => {
        const d = toDateOnly(inv.invoice_date);
        return d >= windowStart && d <= asOf;
      })
      .reduce((sum, inv) => sum + inv.total, 0);
    const arSegment = identityFilteredRows.reduce((sum, r) => sum + r.total, 0);
    if (creditSales90 <= 0) return null;
    return (arSegment / creditSales90) * 90;
  }, [loaded, invoices, identityFilteredRows, customerIndex, asOfDate, search, locationFilter]);

  const locationRows = useMemo<LocationRow[]>(() => {
    const q = search.trim().toLowerCase();
    const byState = new Map<string, LocationRow>();
    const customersByState = new Map<string, Set<string>>();
    for (const l of lines) {
      if (locationFilter !== "all" && l.state !== locationFilter) continue;
      if (q && !l.customerName.toLowerCase().includes(q) && !l.customerCode.toLowerCase().includes(q)) continue;
      let row = byState.get(l.state);
      if (!row) {
        row = { state: l.state, customerCount: 0, ...EMPTY_BUCKETS };
        byState.set(l.state, row);
        customersByState.set(l.state, new Set());
      }
      row[l.bucket] += l.outstanding;
      row.total += l.outstanding;
      customersByState.get(l.state)!.add(l.customerId);
    }
    for (const [state, row] of byState) {
      row.customerCount = customersByState.get(state)!.size;
    }
    return Array.from(byState.values()).sort((a, b) => b.total - a.total);
  }, [lines, locationFilter, search]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" || key === "state" ? "asc" : "desc");
    }
  }

  function sortArrow(key: SortKey) {
    if (key !== sortKey) return "";
    return sortDir === "asc" ? " ▲" : " ▼";
  }

  function resetFilters() {
    setAsOfDate(todayISO());
    setSearch("");
    setLocationFilter("all");
    setBucketFilter("all");
    setMinOutstanding("");
    setOverdueOnly(false);
    setOverLimitOnly(false);
  }

  const activeBucketCols = BUCKET_COLS.filter((b) => visibleBuckets[b.key]);
  const asOfLabel = toDateOnly(asOfDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  const filtersActive =
    search !== "" || locationFilter !== "all" || bucketFilter !== "all" || minOutstanding !== "" ||
    overdueOnly || overLimitOnly || asOfDate !== todayISO();

  // ---- export: one shared table builder feeding CSV / Excel / PDF -----------

  function buildExportTable(): { title: string; columns: ExportColumn[]; rows: (string | number)[][]; footer?: (string | number)[] } {
    if (exportTemplate === "detailed") {
      const columns: ExportColumn[] = [
        { header: "Invoice No", type: "text" },
        { header: "Customer Code", type: "text" },
        { header: "Customer Name", type: "text" },
        ...(showLocationCol ? [{ header: "Location", type: "text" as const }] : []),
        { header: "Invoice Date", type: "text" },
        { header: "Due Date", type: "text" },
        { header: "Days Overdue", type: "number" },
        { header: "Bucket", type: "text" },
        { header: "Outstanding", type: "currency" },
      ];
      const filteredIds = new Set(filteredRows.map((r) => r.id));
      const detailLines = lines
        .filter((l) => filteredIds.has(l.customerId))
        .filter((l) => bucketFilter === "all" || l.bucket === bucketFilter)
        .sort((a, b) => a.customerName.localeCompare(b.customerName) || a.dueDate.localeCompare(b.dueDate));
      const bucketLabel = Object.fromEntries(BUCKET_COLS.map((b) => [b.key, b.header]));
      const rows = detailLines.map((l) => [
        l.invoiceNo, l.customerCode, l.customerName,
        ...(showLocationCol ? [l.state] : []),
        l.invoiceDate, l.dueDate, l.daysOverdue, bucketLabel[l.bucket], l.outstanding,
      ]);
      const total = detailLines.reduce((s, l) => s + l.outstanding, 0);
      const footer = ["", "", "Total", ...(showLocationCol ? [""] : []), "", "", "", "", total];
      return { title: `AR Ageing — Detailed (invoice level), as of ${asOfLabel}`, columns, rows, footer };
    }

    if (exportTemplate === "location") {
      const columns: ExportColumn[] = [
        { header: "Location", type: "text" },
        { header: "Customers", type: "number" },
        ...activeBucketCols.map((b) => ({ header: b.header, type: "currency" as const })),
        { header: "Total Outstanding", type: "currency" },
      ];
      const rows = locationRows.map((r) => [r.state, r.customerCount, ...activeBucketCols.map((b) => r[b.key]), r.total]);
      const total = locationRows.reduce((s, r) => s + r.total, 0);
      const footer = ["Grand Total", locationRows.reduce((s, r) => s + r.customerCount, 0), ...activeBucketCols.map((b) => locationRows.reduce((s, r) => s + r[b.key], 0)), total];
      return { title: `AR Ageing — By Location, as of ${asOfLabel}`, columns, rows, footer };
    }

    const columns: ExportColumn[] = [
      { header: "Customer Code", type: "text" },
      { header: "Customer Name", type: "text" },
      ...(showLocationCol ? [{ header: "Location", type: "text" as const }] : []),
      ...(showCreditLimitCol ? [{ header: "Credit Limit", type: "currency" as const }] : []),
      ...activeBucketCols.map((b) => ({ header: b.header, type: "currency" as const })),
      { header: "Total Outstanding", type: "currency" },
      { header: "Over Limit", type: "text" },
    ];
    const rows = sortedRows.map((r) => [
      r.code, r.name,
      ...(showLocationCol ? [r.state] : []),
      ...(showCreditLimitCol ? [r.creditLimit] : []),
      ...activeBucketCols.map((b) => r[b.key]),
      r.total,
      r.overLimit ? "Yes" : "",
    ]);
    const footer = [
      "", "Grand Total",
      ...(showLocationCol ? [""] : []),
      ...(showCreditLimitCol ? [""] : []),
      ...activeBucketCols.map((b) => grandTotal[b.key]),
      grandTotal.total,
      "",
    ];
    return { title: `AR Ageing — Summary, as of ${asOfLabel}`, columns, rows, footer };
  }

  function exportCsv() {
    const { columns, rows, footer } = buildExportTable();
    const fmt = (v: string | number, type: ExportColumn["type"]) =>
      type === "currency" ? Number(v).toFixed(2) : String(v);
    const lines = [columns.map((c) => c.header).map(csvCell).join(",")];
    for (const row of rows) lines.push(row.map((v, i) => csvCell(fmt(v, columns[i].type))).join(","));
    if (footer) lines.push(footer.map((v, i) => csvCell(fmt(v, columns[i].type))).join(","));
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ar-ageing-${exportTemplate}-${asOfDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportXlsx() {
    const { title, columns, rows, footer } = buildExportTable();
    const header = columns.map((c) => c.header);
    const aoa: (string | number)[][] = [[title], [], header, ...rows, ...(footer ? [footer] : [])];
    const sheet = XLSX.utils.aoa_to_sheet(aoa);
    sheet["!cols"] = columns.map((c) => ({ wch: c.header.length < 14 ? 16 : c.header.length + 4 }));
    sheet["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: header.length - 1 } }];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "AR Ageing");
    XLSX.writeFile(workbook, `ar-ageing-${exportTemplate}-${asOfDate}.xlsx`);
  }

  function exportPdf() {
    const { title, columns, rows, footer } = buildExportTable();
    const doc = new jsPDF({ orientation: "landscape" });
    doc.setFontSize(13);
    doc.text(title, 14, 16);
    const fmt = (v: string | number, type: ExportColumn["type"]) =>
      type === "currency" ? formatCurrency(Number(v)) : String(v);
    autoTable(doc, {
      startY: 22,
      head: [columns.map((c) => c.header)],
      body: rows.map((row) => row.map((v, i) => fmt(v, columns[i].type))),
      foot: footer ? [footer.map((v, i) => fmt(v, columns[i].type))] : undefined,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [35, 64, 139] },
      footStyles: { fillColor: [238, 242, 250], textColor: [15, 23, 42], fontStyle: "bold" },
      columnStyles: { 0: { cellWidth: 40 } },
    });
    doc.save(`ar-ageing-${exportTemplate}-${asOfDate}.pdf`);
  }

  return (
    <div className="mx-auto max-w-7xl">
      <div className="flex items-end justify-between gap-4 print:hidden">
        <PageHeader title="AR Ageing Report" subtitle={`Outstanding by age bucket, as of ${asOfLabel}`} />
        {isConfigured && summaryRows.length > 0 && (
          <div className="mb-6 flex flex-none flex-wrap items-end justify-end gap-2">
            <FormField label="Export template">
              <select className={inputClass} value={exportTemplate} onChange={(e) => setExportTemplate(e.target.value as ExportTemplate)}>
                {EXPORT_TEMPLATES.map((t) => (
                  <option key={t.key} value={t.key}>{t.label}</option>
                ))}
              </select>
            </FormField>
            <button type="button" onClick={exportCsv} className="rounded-lg border border-brand px-4 py-2 text-sm font-semibold text-brand transition-all duration-200 hover:bg-brand-50 active:scale-95 dark:border-brand-300 dark:text-brand-300 dark:hover:bg-brand-900/30">
              CSV
            </button>
            <button type="button" onClick={exportXlsx} className="rounded-lg border border-brand px-4 py-2 text-sm font-semibold text-brand transition-all duration-200 hover:bg-brand-50 active:scale-95 dark:border-brand-300 dark:text-brand-300 dark:hover:bg-brand-900/30">
              Excel
            </button>
            <button type="button" onClick={exportPdf} className="rounded-lg border border-brand px-4 py-2 text-sm font-semibold text-brand transition-all duration-200 hover:bg-brand-50 active:scale-95 dark:border-brand-300 dark:text-brand-300 dark:hover:bg-brand-900/30">
              PDF
            </button>
            <button type="button" onClick={() => window.print()} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition-all duration-200 hover:bg-brand-700 active:scale-95">
              Print
            </button>
          </div>
        )}
      </div>
      <p className="-mt-4 mb-4 text-xs text-slate-400 dark:text-slate-500 print:hidden">
        {EXPORT_TEMPLATES.find((t) => t.key === exportTemplate)?.hint}
      </p>

      {/* Print-only header, since the app chrome is hidden when printing */}
      <div className="mb-4 hidden print:block">
        <h1 className="text-xl font-bold text-brand">AR Ageing Report</h1>
        <p className="text-sm text-slate-500">As of {asOfLabel}</p>
      </div>

      {!isConfigured && <NotConfigured />}

      {isConfigured && error && (
        <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-6 text-red-800 dark:border-red-500/40 dark:bg-red-950/40 dark:text-red-200">
          <p className="font-semibold">Couldn&apos;t load the ageing report.</p>
          <p className="mt-1 text-sm">{error}</p>
        </div>
      )}

      {isConfigured && !error && !loaded && (
        <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>
      )}

      {isConfigured && !error && loaded && (
        <>
          {/* KPI tiles */}
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5 print:hidden">
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Total Outstanding</p>
              <p className="mt-1 text-xl font-bold text-brand dark:text-brand-300">{formatCurrency(grandTotal.total)}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Overdue</p>
              <p className="mt-1 text-xl font-bold text-red-600 dark:text-red-400">{formatCurrency(grandTotal.total - grandTotal.notDue)}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Not Due</p>
              <p className="mt-1 text-xl font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(grandTotal.notDue)}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Over Credit Limit</p>
              <p className="mt-1 text-xl font-bold text-amber-600 dark:text-amber-400">{overLimitCount} customer{overLimitCount === 1 ? "" : "s"}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">DSO (trailing 90d)</p>
              <p className="mt-1 text-xl font-bold text-slate-800 dark:text-slate-100">{dso === null ? "N/A" : `${dso.toFixed(0)} days`}</p>
            </div>
          </div>

          {/* Filters */}
          <div className="mb-3 grid gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 print:hidden sm:grid-cols-2 lg:grid-cols-6">
            <FormField label="As of date">
              <input
                type="date"
                className={inputClass}
                value={asOfDate}
                max={todayISO()}
                onChange={(e) => setAsOfDate(e.target.value || todayISO())}
              />
            </FormField>
            <FormField label="Customer">
              <input
                type="text"
                className={inputClass}
                placeholder="Search name or code…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </FormField>
            <FormField label="Location">
              <select className={inputClass} value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)}>
                <option value="all">All locations</option>
                {locations.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Bucket">
              <select className={inputClass} value={bucketFilter} onChange={(e) => setBucketFilter(e.target.value as "all" | Bucket)}>
                <option value="all">All buckets</option>
                {BUCKET_COLS.map((b) => (
                  <option key={b.key} value={b.key}>{b.header}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Min. outstanding (₹)">
              <input
                type="number"
                min="0"
                className={inputClass}
                placeholder="0"
                value={minOutstanding}
                onChange={(e) => setMinOutstanding(e.target.value)}
              />
            </FormField>
            <div className="flex items-end">
              <button
                type="button"
                onClick={resetFilters}
                disabled={!filtersActive}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Reset filters
              </button>
            </div>

            <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
              <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand dark:border-slate-700" />
              Overdue only
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
              <input type="checkbox" checked={overLimitOnly} onChange={(e) => setOverLimitOnly(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand dark:border-slate-700" />
              Over credit limit only
            </label>
          </div>

          {/* Column customizer */}
          <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm dark:border-slate-800 dark:bg-slate-900 print:hidden">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Columns:</span>
            {BUCKET_COLS.map((b) => (
              <label key={b.key} className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={visibleBuckets[b.key]}
                  onChange={(e) => setVisibleBuckets((v) => ({ ...v, [b.key]: e.target.checked }))}
                  className="h-3.5 w-3.5 rounded border-slate-300 text-brand focus:ring-brand dark:border-slate-700"
                />
                {b.header}
              </label>
            ))}
            <label className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
              <input type="checkbox" checked={showLocationCol} onChange={(e) => setShowLocationCol(e.target.checked)} className="h-3.5 w-3.5 rounded border-slate-300 text-brand focus:ring-brand dark:border-slate-700" />
              Location
            </label>
            <label className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
              <input type="checkbox" checked={showCreditLimitCol} onChange={(e) => setShowCreditLimitCol(e.target.checked)} className="h-3.5 w-3.5 rounded border-slate-300 text-brand focus:ring-brand dark:border-slate-700" />
              Credit Limit
            </label>
          </div>

          <p className="mb-2 text-xs text-slate-400 dark:text-slate-500 print:hidden">
            Showing {sortedRows.length} of {summaryRows.length} customer{summaryRows.length === 1 ? "" : "s"} with an outstanding balance.
          </p>

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left dark:border-slate-800 dark:bg-slate-800/50">
                  <th className="cursor-pointer select-none px-4 py-3 font-semibold text-slate-600 dark:text-slate-300" onClick={() => toggleSort("name")}>
                    Customer{sortArrow("name")}
                  </th>
                  {showLocationCol && (
                    <th className="cursor-pointer select-none px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-300" onClick={() => toggleSort("state")}>
                      Location{sortArrow("state")}
                    </th>
                  )}
                  {showCreditLimitCol && (
                    <th className="cursor-pointer select-none px-4 py-3 text-right font-semibold text-slate-600 dark:text-slate-300" onClick={() => toggleSort("creditLimit")}>
                      Credit Limit{sortArrow("creditLimit")}
                    </th>
                  )}
                  {activeBucketCols.map((b) => (
                    <th key={b.key} className="cursor-pointer select-none px-4 py-3 text-right font-semibold text-slate-600 dark:text-slate-300" onClick={() => toggleSort(b.key)}>
                      {b.header}{sortArrow(b.key)}
                    </th>
                  ))}
                  <th className="cursor-pointer select-none px-4 py-3 text-right font-semibold text-slate-600 dark:text-slate-300" onClick={() => toggleSort("total")}>
                    Total Outstanding{sortArrow("total")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={1 + (showLocationCol ? 1 : 0) + (showCreditLimitCol ? 1 : 0) + activeBucketCols.length + 1}
                      className="px-4 py-10 text-center text-slate-400 dark:text-slate-500"
                    >
                      {summaryRows.length === 0 ? "Nothing outstanding — every invoice is fully paid." : "No customers match these filters."}
                    </td>
                  </tr>
                ) : (
                  <>
                    {sortedRows.map((r) => (
                      <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50">
                        <td className="px-4 py-3 font-medium text-slate-700 dark:text-slate-300">
                          {r.name}
                          <span className="ml-2 text-xs font-normal text-slate-400 dark:text-slate-500">{r.code}</span>
                          {r.overLimit && (
                            <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                              Over limit
                            </span>
                          )}
                        </td>
                        {showLocationCol && <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{r.state}</td>}
                        {showCreditLimitCol && <td className="px-4 py-3 text-right text-slate-700 dark:text-slate-300">{formatCurrency(r.creditLimit)}</td>}
                        {activeBucketCols.map((b) => (
                          <td key={b.key} className="px-4 py-3 text-right text-slate-700 dark:text-slate-300">
                            {r[b.key] > 0 ? formatCurrency(r[b.key]) : "–"}
                          </td>
                        ))}
                        <td className="px-4 py-3 text-right font-semibold text-brand dark:text-brand-300">
                          {formatCurrency(r.total)}
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-slate-50 font-semibold dark:bg-slate-800/50">
                      <td className="px-4 py-3 text-slate-800 dark:text-slate-100">Grand Total</td>
                      {showLocationCol && <td className="px-4 py-3" />}
                      {showCreditLimitCol && <td className="px-4 py-3" />}
                      {activeBucketCols.map((b) => (
                        <td key={b.key} className="px-4 py-3 text-right text-slate-800 dark:text-slate-100">
                          {formatCurrency(grandTotal[b.key])}
                        </td>
                      ))}
                      <td className="px-4 py-3 text-right text-brand dark:text-brand-300">{formatCurrency(grandTotal.total)}</td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
