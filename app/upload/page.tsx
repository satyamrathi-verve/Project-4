"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase, isConfigured } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { ScreenIcon } from "@/components/icons";

const EXPECTED_COLUMNS = ["code", "name", "contact_person", "email", "phone", "credit_limit", "credit_days"];
const REQUIRED_COLUMNS = ["code", "name"];

const SAMPLE_CSV = `code,name,contact_person,email,phone,credit_limit,credit_days
CUST101,Acme Traders,Raj Mehta,raj@acmetraders.com,9876543210,500000,30
CUST102,Bright Textiles,Priya Singh,priya@brighttextiles.com,9123456780,250000,45
`;
const SAMPLE_CSV_HREF = `data:text/csv;charset=utf-8,${encodeURIComponent(SAMPLE_CSV)}`;

type RowStatus = "valid" | "invalid" | "duplicate";

interface ParsedRow {
  line: number;
  code: string;
  name: string;
  contact_person: string;
  email: string;
  phone: string;
  creditLimitRaw: string;
  creditDaysRaw: string;
  creditLimit: number;
  creditDays: number;
  status: RowStatus;
  reasons: string[];
}

interface ImportResult {
  imported: number;
  skippedInvalid: number;
  skippedDuplicate: number;
}

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

function parseOptionalNumber(raw: string): { value: number; error: boolean } {
  const trimmed = raw.trim();
  if (trimmed === "") return { value: 0, error: false };
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return { value: 0, error: true };
  return { value: n, error: false };
}

function parseCsvFile(text: string, existingCodes: Set<string>): { headerError: string | null; rows: ParsedRow[] } {
  const lines = text.split(/\r\n|\r|\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headerError: "That file is empty.", rows: [] };

  const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length > 0) {
    return { headerError: `The CSV header is missing required column(s): ${missing.join(", ")}.`, rows: [] };
  }

  const colIndex = (col: string) => header.indexOf(col);
  const idx = {
    code: colIndex("code"),
    name: colIndex("name"),
    contact_person: colIndex("contact_person"),
    email: colIndex("email"),
    phone: colIndex("phone"),
    credit_limit: colIndex("credit_limit"),
    credit_days: colIndex("credit_days"),
  };

  const field = (fields: string[], i: number) => (i >= 0 && i < fields.length ? fields[i].trim() : "");

  const rows: ParsedRow[] = lines.slice(1).map((line, i) => {
    const fields = parseCsvLine(line);
    const code = field(fields, idx.code);
    const name = field(fields, idx.name);
    const creditLimitRaw = field(fields, idx.credit_limit);
    const creditDaysRaw = field(fields, idx.credit_days);
    const creditLimit = parseOptionalNumber(creditLimitRaw);
    const creditDays = parseOptionalNumber(creditDaysRaw);

    const reasons: string[] = [];
    if (!code) reasons.push("Missing code");
    if (!name) reasons.push("Missing name");
    if (creditLimit.error) reasons.push("Invalid credit limit");
    if (creditDays.error) reasons.push("Invalid credit days");

    return {
      line: i + 2, // +1 for header row, +1 for 1-based
      code,
      name,
      contact_person: field(fields, idx.contact_person),
      email: field(fields, idx.email),
      phone: field(fields, idx.phone),
      creditLimitRaw,
      creditDaysRaw,
      creditLimit: creditLimit.value,
      creditDays: creditDays.value,
      status: reasons.length > 0 ? "invalid" : "valid",
      reasons,
    };
  });

  const seenInFile = new Set<string>();
  for (const row of rows) {
    if (row.status !== "valid") continue;
    const key = row.code.toLowerCase();
    if (existingCodes.has(key)) {
      row.status = "duplicate";
      row.reasons.push("Duplicate of an existing customer code");
    } else if (seenInFile.has(key)) {
      row.status = "duplicate";
      row.reasons.push("Duplicate code within this file");
    } else {
      seenInFile.add(key);
    }
  }

  return { headerError: null, rows };
}

function rowClass(status: RowStatus): string {
  if (status === "invalid") return "border-b border-slate-100 bg-red-50 dark:border-slate-800 dark:bg-red-950/30";
  if (status === "duplicate") return "border-b border-slate-100 bg-amber-50 dark:border-slate-800 dark:bg-amber-950/30";
  return "border-b border-slate-100 last:border-0 dark:border-slate-800";
}

function StatusNote({ row }: { row: ParsedRow }) {
  if (row.status === "valid") {
    return <span className="font-medium text-emerald-600 dark:text-emerald-400">Valid</span>;
  }
  if (row.status === "duplicate") {
    return <span className="font-medium text-amber-600 dark:text-amber-400">Skipped — {row.reasons.join("; ")}</span>;
  }
  return <span className="font-medium text-red-600 dark:text-red-400">Invalid — {row.reasons.join("; ")}</span>;
}

export default function UploadReportPage() {
  const [existingCodes, setExistingCodes] = useState<Set<string>>(new Set());
  const [dragActive, setDragActive] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [headerError, setHeaderError] = useState<string | null>(null);
  const [rows, setRows] = useState<ParsedRow[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [rowFilter, setRowFilter] = useState<"all" | RowStatus>("all");

  async function loadExistingCodes() {
    if (!supabase) return;
    const { data, error } = await supabase.from("customers").select("code");
    if (!error && data) {
      setExistingCodes(new Set((data as { code: string }[]).map((d) => d.code.trim().toLowerCase())));
    }
  }

  useEffect(() => {
    loadExistingCodes();
  }, []);

  function reset() {
    setFileName(null);
    setHeaderError(null);
    setRows(null);
    setImportError(null);
    setImportResult(null);
    setRowFilter("all");
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
      const { headerError: hErr, rows: parsed } = parseCsvFile(text, existingCodes);
      setHeaderError(hErr);
      setRows(hErr ? null : parsed);
    };
    reader.onerror = () => setHeaderError("Couldn't read that file. Please try again.");
    reader.readAsText(file);
  }

  async function handleImport() {
    if (!supabase || !rows) return;
    const validRows = rows.filter((r) => r.status === "valid");
    if (validRows.length === 0) return;

    setImporting(true);
    setImportError(null);
    const payload = validRows.map((r) => ({
      code: r.code,
      name: r.name,
      contact_person: r.contact_person || null,
      email: r.email || null,
      phone: r.phone || null,
      credit_limit: r.creditLimit,
      credit_days: r.creditDays,
    }));
    const { error } = await supabase.from("customers").insert(payload);
    setImporting(false);

    if (error) {
      setImportError(error.message);
      return;
    }

    setImportResult({
      imported: validRows.length,
      skippedInvalid: rows.filter((r) => r.status === "invalid").length,
      skippedDuplicate: rows.filter((r) => r.status === "duplicate").length,
    });
    loadExistingCodes();
  }

  const counts = useMemo(() => {
    const valid = rows?.filter((r) => r.status === "valid").length ?? 0;
    const invalid = rows?.filter((r) => r.status === "invalid").length ?? 0;
    const duplicate = rows?.filter((r) => r.status === "duplicate").length ?? 0;
    return { valid, invalid, duplicate };
  }, [rows]);

  const visibleRows = useMemo(() => {
    if (!rows) return [];
    return rowFilter === "all" ? rows : rows.filter((r) => r.status === rowFilter);
  }, [rows, rowFilter]);

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title="Upload Report" subtitle="Bulk import customers from a CSV file." />

      {!isConfigured && <NotConfigured />}

      {isConfigured && (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-stretch">
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
              className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-10 text-center transition-colors ${
                dragActive
                  ? "border-brand bg-brand-50 dark:border-brand-400 dark:bg-brand-900/20"
                  : "border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900"
              }`}
            >
              <ScreenIcon name="upload" className="h-8 w-8 text-slate-400 dark:text-slate-500" />
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Drag and drop a CSV file here, or{" "}
                <label className="cursor-pointer text-brand hover:underline dark:text-brand-300">
                  browse
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
              </p>
              <p className="text-xs text-slate-400 dark:text-slate-500">Only .csv files are supported.</p>
              {fileName && (
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  Selected: {fileName} ·{" "}
                  <button type="button" onClick={reset} className="text-brand hover:underline dark:text-brand-300">
                    choose a different file
                  </button>
                </p>
              )}
            </div>

            <div className="flex flex-col justify-center gap-2 rounded-xl border border-slate-200 bg-white p-4 text-sm dark:border-slate-800 dark:bg-slate-900 sm:w-72">
              <p className="font-semibold text-slate-700 dark:text-slate-300">Expected columns</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{EXPECTED_COLUMNS.join(", ")}</p>
              <p className="text-xs text-slate-400 dark:text-slate-500">Only code and name are required; the rest can be left blank.</p>
              <a
                href={SAMPLE_CSV_HREF}
                download="customers-sample.csv"
                className="mt-1 inline-flex items-center gap-1 font-medium text-brand hover:underline dark:text-brand-300"
              >
                Download sample CSV
              </a>
            </div>
          </div>

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
                Imported {importResult.imported} customer{importResult.imported === 1 ? "" : "s"}. Skipped{" "}
                {importResult.skippedDuplicate} duplicate{importResult.skippedDuplicate === 1 ? "" : "s"} and{" "}
                {importResult.skippedInvalid} invalid row{importResult.skippedInvalid === 1 ? "" : "s"}.
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

          {rows && rows.length > 0 && (
            <>
              <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
                <button
                  type="button"
                  onClick={() => setRowFilter("all")}
                  className={`rounded-full px-3 py-1 font-medium transition-colors ${
                    rowFilter === "all" ? "bg-slate-700 text-white dark:bg-slate-200 dark:text-slate-900" : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                  }`}
                >
                  All ({rows?.length ?? 0})
                </button>
                <button
                  type="button"
                  onClick={() => setRowFilter(rowFilter === "valid" ? "all" : "valid")}
                  className={`rounded-full px-3 py-1 font-medium transition-colors ${
                    rowFilter === "valid" ? "bg-emerald-600 text-white" : "bg-emerald-50 text-emerald-600 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-400 dark:hover:bg-emerald-900/40"
                  }`}
                >
                  {counts.valid} valid
                </button>
                <button
                  type="button"
                  onClick={() => setRowFilter(rowFilter === "duplicate" ? "all" : "duplicate")}
                  className={`rounded-full px-3 py-1 font-medium transition-colors ${
                    rowFilter === "duplicate" ? "bg-amber-600 text-white" : "bg-amber-50 text-amber-600 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-400 dark:hover:bg-amber-900/40"
                  }`}
                >
                  {counts.duplicate} duplicate (skipped)
                </button>
                <button
                  type="button"
                  onClick={() => setRowFilter(rowFilter === "invalid" ? "all" : "invalid")}
                  className={`rounded-full px-3 py-1 font-medium transition-colors ${
                    rowFilter === "invalid" ? "bg-red-600 text-white" : "bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-950/40 dark:text-red-400 dark:hover:bg-red-900/40"
                  }`}
                >
                  {counts.invalid} invalid (skipped)
                </button>
              </div>

              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-left dark:border-slate-800 dark:bg-slate-800/50">
                      <th className="whitespace-nowrap px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">Row</th>
                      <th className="whitespace-nowrap px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">Code</th>
                      <th className="whitespace-nowrap px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">Name</th>
                      <th className="whitespace-nowrap px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">Contact Person</th>
                      <th className="whitespace-nowrap px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">Email</th>
                      <th className="whitespace-nowrap px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">Phone</th>
                      <th className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-600 dark:text-slate-300">Credit Limit</th>
                      <th className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-600 dark:text-slate-300">Credit Days</th>
                      <th className="whitespace-nowrap px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-4 py-10 text-center text-slate-400 dark:text-slate-500">
                          No rows match this filter.
                        </td>
                      </tr>
                    ) : (
                      visibleRows.map((r) => (
                      <tr key={r.line} className={rowClass(r.status)}>
                        <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{r.line}</td>
                        <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{r.code || "—"}</td>
                        <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{r.name || "—"}</td>
                        <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{r.contact_person || "—"}</td>
                        <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{r.email || "—"}</td>
                        <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{r.phone || "—"}</td>
                        <td className="px-4 py-3 text-right text-slate-700 dark:text-slate-300">
                          {r.creditLimitRaw ? r.creditLimit : "—"}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-700 dark:text-slate-300">
                          {r.creditDaysRaw ? r.creditDays : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <StatusNote row={r} />
                        </td>
                      </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {!importResult && (
                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    disabled={counts.valid === 0 || importing}
                    onClick={handleImport}
                    className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition-all duration-200 hover:bg-brand-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {importing ? "Importing…" : `Import ${counts.valid} valid row${counts.valid === 1 ? "" : "s"}`}
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
