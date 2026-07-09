"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase, isConfigured } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { formatCurrency, addDays, todayISO, round2 } from "@/lib/format";

type Mode = "customers" | "invoices";
type RowStatus = "ready" | "issue";

interface CustomerDraftRow {
  code: string;
  name: string;
  contact_person: string;
  email: string;
  phone: string;
  credit_limit: string;
  credit_days: string;
}

interface InvoiceDraftRow {
  customer_code: string;
  due_date: string;
  description: string;
  qty: string;
  rate: string;
  tax_amount: string;
}

interface CustomerInfo {
  id: string;
  name: string;
  credit_days: number;
}

const CUSTOMERS_SAMPLE_CSV = `code,name,contact_person,email,phone,credit_limit,credit_days
CUST101,Acme Traders,Raj Mehta,raj@acmetraders.com,9876543210,500000,30
CUST102,Bright Textiles,Priya Singh,priya@brighttextiles.com,9123456780,250000,45
`;
const INVOICES_SAMPLE_CSV = `customer_code,due_date,description,qty,rate,tax_amount
CUST101,2026-08-15,Consulting services,10,2500,0
CUST102,,Office supplies,25,150,0
`;
const CUSTOMERS_SAMPLE_HREF = `data:text/csv;charset=utf-8,${encodeURIComponent(CUSTOMERS_SAMPLE_CSV)}`;
const INVOICES_SAMPLE_HREF = `data:text/csv;charset=utf-8,${encodeURIComponent(INVOICES_SAMPLE_CSV)}`;

const PAGE_SIZE = 8;

/** Splits one CSV line into fields, honoring "quoted, fields" with embedded commas. */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields.map((f) => f.trim());
}

function splitCsvLines(text: string): string[][] {
  return text
    .split(/\r\n|\r|\n/)
    .filter((l) => l.trim().length > 0)
    .map(parseCsvLine);
}

function parseOptionalNumber(raw: string): { ok: boolean; value: number } {
  const t = raw.trim();
  if (t === "") return { ok: true, value: 0 };
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return { ok: false, value: 0 };
  return { ok: true, value: n };
}

function parseRequiredNonNegativeNumber(raw: string): { ok: boolean; value: number } {
  const t = raw.trim();
  if (t === "") return { ok: false, value: 0 };
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return { ok: false, value: 0 };
  return { ok: true, value: n };
}

function parseRequiredPositiveNumber(raw: string): { ok: boolean; value: number } {
  const t = raw.trim();
  if (t === "") return { ok: false, value: 0 };
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return { ok: false, value: 0 };
  return { ok: true, value: n };
}

function isValidISODate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return !Number.isNaN(new Date(s + "T00:00:00").getTime());
}

function field(fields: string[], i: number): string {
  return i >= 0 && i < fields.length ? fields[i].trim() : "";
}

function parseCustomersCsv(text: string): { headerError: string | null; rows: CustomerDraftRow[] } {
  const lines = splitCsvLines(text);
  if (lines.length === 0) return { headerError: "That file is empty.", rows: [] };
  const header = lines[0].map((h) => h.toLowerCase());
  const missing = ["code", "name"].filter((c) => !header.includes(c));
  if (missing.length > 0) {
    return { headerError: `The CSV header is missing required column(s): ${missing.join(", ")}.`, rows: [] };
  }
  const idx = {
    code: header.indexOf("code"),
    name: header.indexOf("name"),
    contact_person: header.indexOf("contact_person"),
    email: header.indexOf("email"),
    phone: header.indexOf("phone"),
    credit_limit: header.indexOf("credit_limit"),
    credit_days: header.indexOf("credit_days"),
  };
  const rows = lines.slice(1).map((f) => ({
    code: field(f, idx.code),
    name: field(f, idx.name),
    contact_person: field(f, idx.contact_person),
    email: field(f, idx.email),
    phone: field(f, idx.phone),
    credit_limit: field(f, idx.credit_limit),
    credit_days: field(f, idx.credit_days),
  }));
  return { headerError: null, rows };
}

function parseInvoicesCsv(text: string): { headerError: string | null; rows: InvoiceDraftRow[] } {
  const lines = splitCsvLines(text);
  if (lines.length === 0) return { headerError: "That file is empty.", rows: [] };
  const header = lines[0].map((h) => h.toLowerCase());
  const missing = ["customer_code"].filter((c) => !header.includes(c));
  if (missing.length > 0) {
    return { headerError: `The CSV header is missing required column(s): ${missing.join(", ")}.`, rows: [] };
  }
  const idx = {
    customer_code: header.indexOf("customer_code"),
    due_date: header.indexOf("due_date"),
    description: header.indexOf("description"),
    qty: header.indexOf("qty"),
    rate: header.indexOf("rate"),
    tax_amount: header.indexOf("tax_amount"),
  };
  const rows = lines.slice(1).map((f) => ({
    customer_code: field(f, idx.customer_code),
    due_date: field(f, idx.due_date),
    description: field(f, idx.description),
    qty: field(f, idx.qty),
    rate: field(f, idx.rate),
    tax_amount: field(f, idx.tax_amount),
  }));
  return { headerError: null, rows };
}

function rowWrapClass(hasRowIssue: boolean): string {
  return hasRowIssue
    ? "border-b border-slate-100 bg-red-50 dark:border-slate-800 dark:bg-red-950/30"
    : "border-b border-slate-100 last:border-0 dark:border-slate-800";
}

function EditableCell({
  value,
  onChange,
  error,
  align,
}: {
  value: string;
  onChange: (v: string) => void;
  error?: string;
  align?: "right";
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      title={error}
      className={`w-full min-w-[7rem] rounded-md border px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-brand ${
        align === "right" ? "text-right" : ""
      } ${
        error
          ? "border-red-300 bg-red-100/70 text-red-900 dark:border-red-500/50 dark:bg-red-950/50 dark:text-red-100"
          : "border-transparent bg-transparent text-slate-800 focus:border-brand focus:bg-white dark:text-slate-200 dark:focus:border-brand-400 dark:focus:bg-slate-800"
      }`}
    />
  );
}

export default function UploadReportPage() {
  const [mode, setMode] = useState<Mode>("customers");
  const [existingCodes, setExistingCodes] = useState<Set<string>>(new Set());
  const [customersByCode, setCustomersByCode] = useState<Map<string, CustomerInfo>>(new Map());
  const [maxInvoiceNum, setMaxInvoiceNum] = useState(0);

  const [dragActive, setDragActive] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [headerError, setHeaderError] = useState<string | null>(null);
  const [customerRows, setCustomerRows] = useState<CustomerDraftRow[]>([]);
  const [invoiceRows, setInvoiceRows] = useState<InvoiceDraftRow[]>([]);
  const [page, setPage] = useState(0);

  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<{ imported: number; issues: number } | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | RowStatus>("all");

  async function loadReferenceData() {
    if (!supabase) return;
    const [{ data: customers }, { data: invoices }] = await Promise.all([
      supabase.from("customers").select("id, code, name, credit_days"),
      supabase.from("invoices").select("invoice_no"),
    ]);
    const codes = new Set<string>();
    const byCode = new Map<string, CustomerInfo>();
    for (const c of (customers ?? []) as { id: string; code: string; name: string; credit_days: number }[]) {
      const key = c.code.trim().toLowerCase();
      codes.add(key);
      byCode.set(key, { id: c.id, name: c.name, credit_days: c.credit_days });
    }
    setExistingCodes(codes);
    setCustomersByCode(byCode);
    let max = 0;
    for (const row of (invoices ?? []) as { invoice_no: string }[]) {
      const m = /^INV-(\d+)$/.exec(row.invoice_no);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    setMaxInvoiceNum(max);
  }

  useEffect(() => {
    loadReferenceData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function reset() {
    setFileName(null);
    setHeaderError(null);
    setCustomerRows([]);
    setInvoiceRows([]);
    setImportError(null);
    setImportResult(null);
    setStatusFilter("all");
    setPage(0);
  }

  function switchMode(next: Mode) {
    if (next === mode) return;
    setMode(next);
    reset();
  }

  function handleFile(file: File | undefined | null) {
    if (!file) return;
    reset();
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setHeaderError("Please upload a .csv file.");
      return;
    }
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      if (mode === "customers") {
        const { headerError: hErr, rows } = parseCustomersCsv(text);
        setHeaderError(hErr);
        setCustomerRows(hErr ? [] : rows);
      } else {
        const { headerError: hErr, rows } = parseInvoicesCsv(text);
        setHeaderError(hErr);
        setInvoiceRows(hErr ? [] : rows);
      }
    };
    reader.onerror = () => setHeaderError("Couldn't read that file. Please try again.");
    reader.readAsText(file);
  }

  function updateCustomerField(index: number, fieldName: keyof CustomerDraftRow, value: string) {
    setCustomerRows((prev) => prev.map((r, i) => (i === index ? { ...r, [fieldName]: value } : r)));
  }

  function updateInvoiceField(index: number, fieldName: keyof InvoiceDraftRow, value: string) {
    setInvoiceRows((prev) => prev.map((r, i) => (i === index ? { ...r, [fieldName]: value } : r)));
  }

  const computedCustomerRows = useMemo(() => {
    return customerRows.map((row, i) => {
      const code = row.code.trim();
      const name = row.name.trim();
      const reasons: string[] = [];
      if (!code) reasons.push("Missing code");
      if (!name) reasons.push("Missing name");
      if (code) {
        const key = code.toLowerCase();
        if (existingCodes.has(key)) reasons.push("Duplicate of an existing customer code");
        else if (customerRows.some((r, j) => j < i && r.code.trim().toLowerCase() === key)) {
          reasons.push("Duplicate code within this file");
        }
      }
      const creditLimit = parseOptionalNumber(row.credit_limit);
      const creditDays = parseOptionalNumber(row.credit_days);
      const fieldErrors: { credit_limit?: string; credit_days?: string } = {};
      if (!creditLimit.ok) fieldErrors.credit_limit = "Must be a non-negative number";
      if (!creditDays.ok) fieldErrors.credit_days = "Must be a non-negative number";
      const rowIssue = reasons.length > 0 ? reasons.join("; ") : null;
      const status: RowStatus = rowIssue || fieldErrors.credit_limit || fieldErrors.credit_days ? "issue" : "ready";
      return {
        sourceIndex: i,
        code,
        name,
        creditLimitValue: creditLimit.value,
        creditDaysValue: creditDays.value,
        rowIssue,
        fieldErrors,
        status,
      };
    });
  }, [customerRows, existingCodes]);

  const computedInvoiceRows = useMemo(() => {
    return invoiceRows.map((row, i) => {
      const code = row.customer_code.trim();
      const match = code ? customersByCode.get(code.toLowerCase()) : undefined;
      const rowIssue = !code ? "Missing customer code" : !match ? "No customer found with this code" : null;

      const fieldErrors: { description?: string; qty?: string; rate?: string; due_date?: string; tax_amount?: string } = {};
      if (!row.description.trim()) fieldErrors.description = "Description is required";
      const qty = parseRequiredPositiveNumber(row.qty);
      if (!qty.ok) fieldErrors.qty = "Must be a positive number";
      const rate = parseRequiredNonNegativeNumber(row.rate);
      if (!rate.ok) fieldErrors.rate = "Must be a non-negative number";
      const taxAmount = parseOptionalNumber(row.tax_amount);
      if (!taxAmount.ok) fieldErrors.tax_amount = "Must be a non-negative number";
      const dueDateRaw = row.due_date.trim();
      if (dueDateRaw && !isValidISODate(dueDateRaw)) fieldErrors.due_date = "Use YYYY-MM-DD";

      const subtotal = qty.ok && rate.ok ? round2(qty.value * rate.value) : 0;
      const total = round2(subtotal + (taxAmount.ok ? taxAmount.value : 0));
      const effectiveDueDate =
        dueDateRaw && !fieldErrors.due_date ? dueDateRaw : match ? addDays(todayISO(), match.credit_days) : "";

      const status: RowStatus = rowIssue || Object.keys(fieldErrors).length > 0 ? "issue" : "ready";

      return {
        sourceIndex: i,
        resolvedCustomerId: match?.id ?? null,
        resolvedCustomerName: match?.name ?? null,
        rowIssue,
        fieldErrors,
        qtyValue: qty.value,
        rateValue: rate.value,
        taxAmountValue: taxAmount.value,
        subtotal,
        total,
        effectiveDueDate,
        status,
      };
    });
  }, [invoiceRows, customersByCode]);

  async function handleImport() {
    if (!supabase) return;
    if (mode === "customers") {
      const ready = computedCustomerRows.filter((r) => r.status === "ready");
      if (ready.length === 0) return;
      setImporting(true);
      setImportError(null);
      const payload = ready.map((r) => {
        const draft = customerRows[r.sourceIndex];
        return {
          code: r.code,
          name: r.name,
          contact_person: draft.contact_person.trim() || null,
          email: draft.email.trim() || null,
          phone: draft.phone.trim() || null,
          credit_limit: r.creditLimitValue,
          credit_days: r.creditDaysValue,
        };
      });
      const { error } = await supabase.from("customers").insert(payload);
      setImporting(false);
      if (error) {
        setImportError(error.message);
        return;
      }
      setImportResult({ imported: ready.length, issues: computedCustomerRows.length - ready.length });
      loadReferenceData();
    } else {
      const ready = computedInvoiceRows.filter((r) => r.status === "ready");
      if (ready.length === 0) return;
      setImporting(true);
      setImportError(null);
      let n = maxInvoiceNum;
      const invoicePayload = ready.map((r) => {
        n += 1;
        return {
          invoice_no: `INV-${String(n).padStart(4, "0")}`,
          invoice_date: todayISO(),
          customer_id: r.resolvedCustomerId as string,
          due_date: r.effectiveDueDate,
          subtotal: r.subtotal,
          tax_amount: r.taxAmountValue,
          total: r.total,
          status: "open" as const,
          notes: null,
        };
      });
      const { data: inserted, error: invErr } = await supabase.from("invoices").insert(invoicePayload).select("id, invoice_no");
      if (invErr || !inserted) {
        setImporting(false);
        setImportError(invErr?.message ?? "Failed to import invoices.");
        return;
      }
      const idByNo = new Map(inserted.map((r) => [r.invoice_no, r.id]));
      const itemsPayload = ready.map((r, i) => ({
        invoice_id: idByNo.get(invoicePayload[i].invoice_no) as string,
        description: invoiceRows[r.sourceIndex].description.trim(),
        qty: r.qtyValue,
        rate: r.rateValue,
        amount: r.subtotal,
      }));
      const { error: itemErr } = await supabase.from("invoice_items").insert(itemsPayload);
      setImporting(false);
      if (itemErr) {
        setImportError(`${ready.length} invoice(s) were created, but their line items failed to save: ${itemErr.message}`);
        loadReferenceData();
        return;
      }
      setImportResult({ imported: ready.length, issues: computedInvoiceRows.length - ready.length });
      loadReferenceData();
    }
  }

  const activeComputed = mode === "customers" ? computedCustomerRows : computedInvoiceRows;
  const readyCount = activeComputed.filter((r) => r.status === "ready").length;
  const issueCount = activeComputed.length - readyCount;
  const filteredComputed = statusFilter === "all" ? activeComputed : activeComputed.filter((r) => r.status === statusFilter);
  const totalPages = Math.max(1, Math.ceil(filteredComputed.length / PAGE_SIZE));
  const start = page * PAGE_SIZE;
  const hasFile = mode === "customers" ? customerRows.length > 0 : invoiceRows.length > 0;

  function toggleStatusFilter(next: RowStatus) {
    setStatusFilter((prev) => (prev === next ? "all" : next));
    setPage(0);
  }

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title="Upload Report" subtitle="Bulk-import customers or invoices from a CSV file instead of punching them one by one." />

      {!isConfigured && <NotConfigured />}

      {isConfigured && (
        <>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragActive(false);
              handleFile(e.dataTransfer.files?.[0]);
            }}
            className={`mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 transition-colors ${
              dragActive
                ? "border-brand bg-brand-50 dark:border-brand-400 dark:bg-brand-900/20"
                : "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
            }`}
          >
            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5 dark:border-slate-700 dark:bg-slate-800">
                <button
                  type="button"
                  onClick={() => switchMode("customers")}
                  className={`rounded-md px-3 py-1.5 text-sm font-semibold transition-colors ${
                    mode === "customers"
                      ? "bg-brand text-white shadow-sm"
                      : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
                  }`}
                >
                  Customers
                </button>
                <button
                  type="button"
                  onClick={() => switchMode("invoices")}
                  className={`rounded-md px-3 py-1.5 text-sm font-semibold transition-colors ${
                    mode === "invoices"
                      ? "bg-brand text-white shadow-sm"
                      : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
                  }`}
                >
                  Invoices
                </button>
              </div>
              <a
                href={mode === "customers" ? CUSTOMERS_SAMPLE_HREF : INVOICES_SAMPLE_HREF}
                download={mode === "customers" ? "customers-sample.csv" : "invoices-sample.csv"}
                className="text-sm font-medium text-brand hover:underline dark:text-brand-300"
              >
                Download sample {mode} CSV
              </a>
            </div>

            <label className="cursor-pointer rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-800 dark:bg-slate-700 dark:hover:bg-slate-600">
              Choose CSV file
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  handleFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
          </div>

          {fileName && (
            <p className="mb-4 -mt-1 text-xs text-slate-400 dark:text-slate-500">
              Loaded {fileName} ·{" "}
              <button type="button" onClick={reset} className="text-brand hover:underline dark:text-brand-300">
                clear
              </button>
            </p>
          )}

          {headerError && (
            <div role="alert" className="mb-4 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-500/40 dark:bg-red-950/40 dark:text-red-200">
              {headerError}
            </div>
          )}

          {importError && (
            <div role="alert" className="mb-4 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-500/40 dark:bg-red-950/40 dark:text-red-200">
              Import failed: {importError}
            </div>
          )}

          {importResult && (
            <div role="status" className="mb-4 flex items-center justify-between gap-4 rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-950/40 dark:text-emerald-200">
              <span>
                Imported {importResult.imported} {mode === "customers" ? "customer" : "invoice"}
                {importResult.imported === 1 ? "" : "s"}.
                {importResult.issues > 0 && ` Skipped ${importResult.issues} row${importResult.issues === 1 ? "" : "s"} with issues.`}
              </span>
              <button
                type="button"
                onClick={reset}
                className="flex-none rounded-lg border border-emerald-400 px-3 py-1.5 font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 dark:border-emerald-500/60 dark:text-emerald-200 dark:hover:bg-emerald-900/40"
              >
                Upload another file
              </button>
            </div>
          )}

          {!hasFile && !headerError && (
            <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-500">
              Choose a CSV file above to preview its rows before importing.
            </div>
          )}

          {hasFile && (
            <>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Preview</h3>
                  <button
                    type="button"
                    onClick={() => {
                      setStatusFilter("all");
                      setPage(0);
                    }}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                      statusFilter === "all"
                        ? "bg-slate-700 text-white dark:bg-slate-200 dark:text-slate-900"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                    }`}
                  >
                    {activeComputed.length} row{activeComputed.length === 1 ? "" : "s"}
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleStatusFilter("ready")}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                      statusFilter === "ready"
                        ? "bg-emerald-600 text-white"
                        : "bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300 dark:hover:bg-emerald-900/70"
                    }`}
                  >
                    {readyCount} ready
                  </button>
                  {issueCount > 0 && (
                    <button
                      type="button"
                      onClick={() => toggleStatusFilter("issue")}
                      className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                        statusFilter === "issue"
                          ? "bg-red-600 text-white"
                          : "bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/40 dark:text-red-300 dark:hover:bg-red-900/70"
                      }`}
                    >
                      {issueCount} issue{issueCount === 1 ? "" : "s"}
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  {totalPages > 1 && (
                    <div className="flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400">
                      <button
                        type="button"
                        disabled={page === 0}
                        onClick={() => setPage((p) => Math.max(0, p - 1))}
                        className="rounded-md border border-slate-200 px-2 py-1 disabled:opacity-40 dark:border-slate-700"
                      >
                        ‹
                      </button>
                      <span className="px-1 text-xs">
                        {page + 1}/{totalPages}
                      </span>
                      <button
                        type="button"
                        disabled={page >= totalPages - 1}
                        onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                        className="rounded-md border border-slate-200 px-2 py-1 disabled:opacity-40 dark:border-slate-700"
                      >
                        ›
                      </button>
                    </div>
                  )}
                  {!importResult && (
                    <button
                      type="button"
                      disabled={readyCount === 0 || importing}
                      onClick={handleImport}
                      className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition-all duration-200 hover:bg-brand-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {importing ? "Inserting…" : `Insert ${readyCount} valid row${readyCount === 1 ? "" : "s"}`}
                    </button>
                  )}
                </div>
              </div>

              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                {mode === "customers" ? (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-left dark:border-slate-800 dark:bg-slate-800/50">
                        <th className="whitespace-nowrap px-3 py-2 font-semibold text-slate-600 dark:text-slate-300">Code</th>
                        <th className="whitespace-nowrap px-3 py-2 font-semibold text-slate-600 dark:text-slate-300">Name</th>
                        <th className="whitespace-nowrap px-3 py-2 font-semibold text-slate-600 dark:text-slate-300">Contact Person</th>
                        <th className="whitespace-nowrap px-3 py-2 font-semibold text-slate-600 dark:text-slate-300">Email</th>
                        <th className="whitespace-nowrap px-3 py-2 font-semibold text-slate-600 dark:text-slate-300">Phone</th>
                        <th className="whitespace-nowrap px-3 py-2 text-right font-semibold text-slate-600 dark:text-slate-300">Credit Limit</th>
                        <th className="whitespace-nowrap px-3 py-2 text-right font-semibold text-slate-600 dark:text-slate-300">Credit Days</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredComputed.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-4 py-10 text-center text-slate-400 dark:text-slate-500">
                            No rows match this filter.
                          </td>
                        </tr>
                      ) : (
                        (filteredComputed as typeof computedCustomerRows).slice(start, start + PAGE_SIZE).map((r) => {
                          const draft = customerRows[r.sourceIndex];
                          return (
                            <tr key={r.sourceIndex} className={rowWrapClass(!!r.rowIssue)} title={r.rowIssue ?? undefined}>
                              <td className="px-2 py-1.5">
                                <EditableCell value={draft.code} onChange={(v) => updateCustomerField(r.sourceIndex, "code", v)} error={r.rowIssue ?? undefined} />
                              </td>
                              <td className="px-2 py-1.5">
                                <EditableCell value={draft.name} onChange={(v) => updateCustomerField(r.sourceIndex, "name", v)} />
                              </td>
                              <td className="px-2 py-1.5">
                                <EditableCell value={draft.contact_person} onChange={(v) => updateCustomerField(r.sourceIndex, "contact_person", v)} />
                              </td>
                              <td className="px-2 py-1.5">
                                <EditableCell value={draft.email} onChange={(v) => updateCustomerField(r.sourceIndex, "email", v)} />
                              </td>
                              <td className="px-2 py-1.5">
                                <EditableCell value={draft.phone} onChange={(v) => updateCustomerField(r.sourceIndex, "phone", v)} />
                              </td>
                              <td className="px-2 py-1.5">
                                <EditableCell align="right" value={draft.credit_limit} onChange={(v) => updateCustomerField(r.sourceIndex, "credit_limit", v)} error={r.fieldErrors.credit_limit} />
                              </td>
                              <td className="px-2 py-1.5">
                                <EditableCell align="right" value={draft.credit_days} onChange={(v) => updateCustomerField(r.sourceIndex, "credit_days", v)} error={r.fieldErrors.credit_days} />
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-left dark:border-slate-800 dark:bg-slate-800/50">
                        <th className="whitespace-nowrap px-3 py-2 font-semibold text-slate-600 dark:text-slate-300">Customer Code</th>
                        <th className="whitespace-nowrap px-3 py-2 font-semibold text-slate-600 dark:text-slate-300">Customer Name</th>
                        <th className="whitespace-nowrap px-3 py-2 font-semibold text-slate-600 dark:text-slate-300">Due Date (optional)</th>
                        <th className="whitespace-nowrap px-3 py-2 font-semibold text-slate-600 dark:text-slate-300">Description</th>
                        <th className="whitespace-nowrap px-3 py-2 text-right font-semibold text-slate-600 dark:text-slate-300">Qty</th>
                        <th className="whitespace-nowrap px-3 py-2 text-right font-semibold text-slate-600 dark:text-slate-300">Rate</th>
                        <th className="whitespace-nowrap px-3 py-2 text-right font-semibold text-slate-600 dark:text-slate-300">Tax Amount</th>
                        <th className="whitespace-nowrap px-3 py-2 text-right font-semibold text-slate-600 dark:text-slate-300">Taxable Value (Qty×Rate)</th>
                        <th className="whitespace-nowrap px-3 py-2 text-right font-semibold text-slate-600 dark:text-slate-300">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredComputed.length === 0 ? (
                        <tr>
                          <td colSpan={9} className="px-4 py-10 text-center text-slate-400 dark:text-slate-500">
                            No rows match this filter.
                          </td>
                        </tr>
                      ) : (
                        (filteredComputed as typeof computedInvoiceRows).slice(start, start + PAGE_SIZE).map((r) => {
                          const draft = invoiceRows[r.sourceIndex];
                          return (
                            <tr key={r.sourceIndex} className={rowWrapClass(!!r.rowIssue)} title={r.rowIssue ?? undefined}>
                              <td className="px-2 py-1.5">
                                <EditableCell value={draft.customer_code} onChange={(v) => updateInvoiceField(r.sourceIndex, "customer_code", v)} error={r.rowIssue ?? undefined} />
                              </td>
                              <td className="whitespace-nowrap px-3 py-1.5 text-slate-500 dark:text-slate-400">{r.resolvedCustomerName ?? "—"}</td>
                              <td className="px-2 py-1.5">
                                <EditableCell value={draft.due_date} onChange={(v) => updateInvoiceField(r.sourceIndex, "due_date", v)} error={r.fieldErrors.due_date} />
                              </td>
                              <td className="px-2 py-1.5">
                                <EditableCell value={draft.description} onChange={(v) => updateInvoiceField(r.sourceIndex, "description", v)} error={r.fieldErrors.description} />
                              </td>
                              <td className="px-2 py-1.5">
                                <EditableCell align="right" value={draft.qty} onChange={(v) => updateInvoiceField(r.sourceIndex, "qty", v)} error={r.fieldErrors.qty} />
                              </td>
                              <td className="px-2 py-1.5">
                                <EditableCell align="right" value={draft.rate} onChange={(v) => updateInvoiceField(r.sourceIndex, "rate", v)} error={r.fieldErrors.rate} />
                              </td>
                              <td className="px-2 py-1.5">
                                <EditableCell align="right" value={draft.tax_amount} onChange={(v) => updateInvoiceField(r.sourceIndex, "tax_amount", v)} error={r.fieldErrors.tax_amount} />
                              </td>
                              <td className="whitespace-nowrap px-3 py-1.5 text-right text-slate-700 dark:text-slate-300">{formatCurrency(r.subtotal)}</td>
                              <td className="whitespace-nowrap px-3 py-1.5 text-right font-medium text-slate-800 dark:text-slate-200">{formatCurrency(r.total)}</td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                )}
              </div>

              <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
                Rows with issues are highlighted red. Fix the value directly in the table (hover a red box to see why), or fix the CSV and re-upload it.
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}
