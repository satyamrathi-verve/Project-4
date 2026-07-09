import type { Invoice, InvoiceStatus, ReceiptAllocation } from "@/lib/types";
import { round2 } from "@/lib/format";

/*
  Shared invoice math, used by the list, view, and form screens so they never
  disagree. Paid/outstanding are never stored columns — they're always the
  sum of that invoice's receipt_allocations (see CLAUDE.md).
*/

// Standard boilerplate — same on every invoice, so it lives in code, not per-invoice
// data. Shared by the form (shown for reference while punching/editing) and the
// printed view, so they never drift apart.
export const TERMS_AND_CONDITIONS = [
  "Payment is due within the agreed payment terms from the invoice date.",
  "Please quote the invoice number on all related payments and correspondence.",
  "Interest may be charged on amounts remaining overdue beyond the due date.",
  "Goods/services once delivered are not returnable except as agreed in writing.",
  "Subject to the jurisdiction of the courts where the company is registered.",
];

export function buildAllocationMap(allocations: ReceiptAllocation[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const a of allocations) {
    map.set(a.invoice_id, (map.get(a.invoice_id) ?? 0) + a.amount);
  }
  return map;
}

export function paidAmount(invoiceId: string, allocationMap: Map<string, number>): number {
  return allocationMap.get(invoiceId) ?? 0;
}

export function balanceDue(invoice: Pick<Invoice, "total">, paid: number): number {
  return invoice.total - paid;
}

/** A 'paid' invoice stays paid; otherwise a past-due-date invoice reads as overdue regardless of the stored status. */
export function displayStatus(invoice: Pick<Invoice, "status" | "due_date">): InvoiceStatus {
  if (invoice.status === "paid") return "paid";
  const due = new Date(invoice.due_date + "T00:00:00");
  const today = new Date(new Date().toDateString());
  if (due < today) return "overdue";
  return invoice.status;
}

/*
  None of these — Payment Terms/Reference Number/Place of Supply/Salesperson,
  the two discounts, or the tax type/rate breakdown — have a column anywhere.
  invoices only has subtotal/tax_amount/total, so:
    - subtotal   stays the raw sum of invoice_items (unchanged meaning)
    - tax_amount is the SUM of the tax breakdown rows, computed on the
      post-before-tax-discount (taxable) amount
    - total      = subtotal - beforeTaxDiscount + tax_amount - afterTaxDiscount
  The human-readable discount/tax breakdown is folded into leading
  "Label: value" lines in `notes` (blank line, then free-text notes) purely
  so it survives a reload for editing/printing — this file is the only place
  that needs to know about that encoding.
*/
export interface InvoiceHeaderFields {
  paymentTerms: string;
  referenceNumber: string;
  placeOfSupply: string;
  salesperson: string;
  createdBy: string;
  updatedBy: string;
  updatedDate: string;
}

export const BLANK_HEADER_FIELDS: InvoiceHeaderFields = {
  paymentTerms: "",
  referenceNumber: "",
  placeOfSupply: "",
  salesperson: "",
  createdBy: "",
  updatedBy: "",
  updatedDate: "",
};

export type DiscountType = "amount" | "percent";

export interface DiscountInfo {
  type: DiscountType;
  value: number;
}

export const BLANK_DISCOUNT: DiscountInfo = { type: "amount", value: 0 };

export type TaxType = "CGST" | "SGST" | "IGST" | "CESS" | "Other";

export const TAX_TYPES: TaxType[] = ["CGST", "SGST", "IGST", "CESS", "Other"];

export interface TaxLine {
  type: TaxType;
  rate: number;
}

export function computeDiscountAmount(subtotal: number, discount: DiscountInfo): number {
  const raw = discount.type === "percent" ? (subtotal * (discount.value || 0)) / 100 : discount.value || 0;
  return round2(Math.min(Math.max(raw, 0), subtotal));
}

export function computeTaxRows(taxableAmount: number, taxLines: TaxLine[]): (TaxLine & { amount: number })[] {
  return taxLines.map((l) => ({ ...l, amount: round2((taxableAmount * (l.rate || 0)) / 100) }));
}

const TEXT_FIELD_LABELS: { key: keyof InvoiceHeaderFields; label: string }[] = [
  { key: "paymentTerms", label: "Payment Terms" },
  { key: "referenceNumber", label: "Reference Number" },
  { key: "placeOfSupply", label: "Place of Supply" },
  { key: "salesperson", label: "Salesperson" },
  { key: "createdBy", label: "Created By" },
  { key: "updatedBy", label: "Updated By" },
  { key: "updatedDate", label: "Updated Date" },
];

const DISCOUNT_PREFIX = "Discount: ";
const AFTER_TAX_DISCOUNT_PREFIX = "After-Tax Discount: ";
const TAX_PREFIX = "Tax Breakdown: ";

function formatDiscountLine(prefix: string, d: DiscountInfo): string | null {
  if (!d.value) return null;
  return d.type === "percent" ? `${prefix}${d.value}%` : `${prefix}₹${d.value.toFixed(2)}`;
}

function parseDiscountLine(prefix: string, line: string): DiscountInfo | null {
  if (!line.startsWith(prefix)) return null;
  const v = line.slice(prefix.length).trim();
  if (v.endsWith("%")) return { type: "percent", value: parseFloat(v) || 0 };
  if (v.startsWith("₹")) return { type: "amount", value: parseFloat(v.slice(1).replace(/,/g, "")) || 0 };
  return null;
}

function formatTaxLine(lines: TaxLine[]): string | null {
  const real = lines.filter((l) => l.rate > 0);
  if (real.length === 0) return null;
  return `${TAX_PREFIX}${real.map((l) => `${l.type} ${l.rate}%`).join(", ")}`;
}

function parseTaxLine(line: string): TaxLine[] | null {
  if (!line.startsWith(TAX_PREFIX)) return null;
  const body = line.slice(TAX_PREFIX.length).trim();
  if (!body) return [];
  const rows = body.split(",").map((tok) => {
    const m = /^(\w+)\s+([\d.]+)%$/.exec(tok.trim());
    if (!m) return null;
    const type = (TAX_TYPES as string[]).includes(m[1]) ? (m[1] as TaxType) : "Other";
    return { type, rate: parseFloat(m[2]) };
  });
  return rows.filter((r): r is TaxLine => r !== null);
}

export interface ParsedInvoiceNotes {
  fields: InvoiceHeaderFields;
  discount: DiscountInfo;
  afterTaxDiscount: DiscountInfo;
  taxLines: TaxLine[];
  notes: string;
}

export function parseNotes(notes: string | null): ParsedInvoiceNotes {
  const fields: InvoiceHeaderFields = { ...BLANK_HEADER_FIELDS };
  let discount: DiscountInfo = { ...BLANK_DISCOUNT };
  let afterTaxDiscount: DiscountInfo = { ...BLANK_DISCOUNT };
  let taxLines: TaxLine[] = [];
  if (!notes) return { fields, discount, afterTaxDiscount, taxLines, notes: "" };

  const lines = notes.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const textMatch = TEXT_FIELD_LABELS.find((f) => line.startsWith(`${f.label}: `));
    if (textMatch) {
      fields[textMatch.key] = line.slice(textMatch.label.length + 2).trim();
      i++;
      continue;
    }
    const afterTax = parseDiscountLine(AFTER_TAX_DISCOUNT_PREFIX, line);
    if (afterTax) {
      afterTaxDiscount = afterTax;
      i++;
      continue;
    }
    const d = parseDiscountLine(DISCOUNT_PREFIX, line);
    if (d) {
      discount = d;
      i++;
      continue;
    }
    const t = parseTaxLine(line);
    if (t) {
      taxLines = t;
      i++;
      continue;
    }
    break;
  }
  while (i < lines.length && lines[i].trim() === "") i++;
  return { fields, discount, afterTaxDiscount, taxLines, notes: lines.slice(i).join("\n") };
}

export function composeNotes(
  fields: InvoiceHeaderFields,
  discount: DiscountInfo,
  afterTaxDiscount: DiscountInfo,
  taxLines: TaxLine[],
  notes: string
): string | null {
  const headerLines: string[] = [];
  for (const f of TEXT_FIELD_LABELS) {
    const v = fields[f.key].trim();
    if (v) headerLines.push(`${f.label}: ${v}`);
  }
  const discountLine = formatDiscountLine(DISCOUNT_PREFIX, discount);
  if (discountLine) headerLines.push(discountLine);
  const afterTaxLine = formatDiscountLine(AFTER_TAX_DISCOUNT_PREFIX, afterTaxDiscount);
  if (afterTaxLine) headerLines.push(afterTaxLine);
  const taxLine = formatTaxLine(taxLines);
  if (taxLine) headerLines.push(taxLine);

  const body = notes.trim();
  if (headerLines.length === 0) return body || null;
  return headerLines.join("\n") + (body ? `\n\n${body}` : "");
}
