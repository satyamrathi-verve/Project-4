import { supabase } from "@/lib/supabase";

/*
  Recurring invoices — schedule an invoice (customer + line items + tax) to be
  raised automatically every week or month, no manual step needed.

  Storage: the schema is fixed (house rule — no new tables), so profiles are
  stored as JSON in `reminder_templates` rows whose name starts with
  "[recurring]". The AR Followup screen filters those rows out of its template
  list, so they're invisible everywhere except the Recurring Invoices screen.

  Generation: `runDueRecurring()` is called on every app load (AuthGate) and on
  the Recurring screen. Any active profile whose nextRun date has arrived gets a
  REAL invoice (+ items) written to the shared books, dated on its scheduled
  day, due after the customer's credit days — then the profile's nextRun
  advances. If the app wasn't opened for a while it catches up, generating one
  invoice per missed period (capped). Duplicate-number races between two open
  browsers are absorbed by the invoice_no unique constraint + one retry.
*/

export const RECURRING_PREFIX = "[recurring]";

export interface RecurringItem {
  description: string;
  qty: number;
  rate: number;
}

export interface RecurringProfile {
  id: string; // reminder_templates row id
  customerId: string;
  customerName: string;
  items: RecurringItem[];
  taxPct: number;
  frequency: "monthly" | "weekly";
  /** Day-of-month anchor for monthly schedules (so the 31st clamps in short months without drifting). */
  anchorDay: number;
  nextRun: string; // YYYY-MM-DD
  active: boolean;
  createdAt: string;
  lastGenerated?: string | null;
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function profileSubtotal(items: RecurringItem[]): number {
  return round2(items.reduce((s, it) => s + it.qty * it.rate, 0));
}

export function profileTotal(p: Pick<RecurringProfile, "items" | "taxPct">): number {
  const sub = profileSubtotal(p.items);
  return round2(sub + round2((sub * p.taxPct) / 100));
}

/* ---------- date helpers (local, no UTC drift) ---------- */

function toISO(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fromISO(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function advanceRun(nextRun: string, frequency: "monthly" | "weekly", anchorDay: number): string {
  const d = fromISO(nextRun);
  if (frequency === "weekly") {
    d.setDate(d.getDate() + 7);
    return toISO(d);
  }
  // monthly: move to next month on the anchor day, clamped to that month's length
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const lastDay = new Date(y, m + 1, 0).getDate();
  return toISO(new Date(y, m, Math.min(anchorDay, lastDay)));
}

/* ---------- profile CRUD (stored in reminder_templates) ---------- */

function rowToProfile(row: { id: string; body: string }): RecurringProfile | null {
  try {
    const data = JSON.parse(row.body);
    if (!data || !data.customerId || !Array.isArray(data.items)) return null;
    return { ...data, id: row.id } as RecurringProfile;
  } catch {
    return null;
  }
}

function profileRow(p: Omit<RecurringProfile, "id">) {
  return {
    name: `${RECURRING_PREFIX} ${p.customerName} — ${p.frequency}`,
    subject: "Recurring invoice profile (managed from Sales Invoices → Recurring)",
    body: JSON.stringify(p),
  };
}

export async function loadProfiles(): Promise<RecurringProfile[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from("reminder_templates").select("id, name, body").like("name", `${RECURRING_PREFIX}%`);
  if (error || !data) return [];
  return data.map(rowToProfile).filter((p): p is RecurringProfile => p !== null);
}

export async function createProfile(p: Omit<RecurringProfile, "id">): Promise<string | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from("reminder_templates").insert(profileRow(p)).select("id").single();
  return error ? null : data.id;
}

export async function updateProfile(p: RecurringProfile): Promise<boolean> {
  if (!supabase) return false;
  const { id, ...rest } = p;
  const { error } = await supabase.from("reminder_templates").update(profileRow(rest)).eq("id", id);
  return !error;
}

export async function deleteProfile(id: string): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.from("reminder_templates").delete().eq("id", id);
  return !error;
}

/* ---------- the generator ---------- */

const CATCH_UP_CAP = 12; // max invoices per profile per run (protects against runaway loops)

export interface GeneratedInvoice {
  invoice_no: string;
  customerName: string;
  total: number;
}

export async function runDueRecurring(): Promise<GeneratedInvoice[]> {
  if (!supabase) return [];
  const today = toISO(new Date());
  const profiles = (await loadProfiles()).filter((p) => p.active && p.nextRun <= today);
  if (profiles.length === 0) return [];

  const { data: custRows } = await supabase.from("customers").select("id, credit_days");
  const creditDays = new Map((custRows ?? []).map((c) => [c.id, Number(c.credit_days) || 30]));

  // Current highest invoice number — incremented locally per insert.
  const { data: nos } = await supabase.from("invoices").select("invoice_no");
  let counter = 0;
  for (const row of nos ?? []) {
    const m = /^INV-(\d+)$/.exec(row.invoice_no);
    if (m) counter = Math.max(counter, parseInt(m[1], 10));
  }

  const generated: GeneratedInvoice[] = [];

  for (const profile of profiles) {
    let { nextRun } = profile;
    let guard = 0;
    let changed = false;

    while (nextRun <= today && guard < CATCH_UP_CAP) {
      guard++;
      const subtotal = profileSubtotal(profile.items);
      const tax = round2((subtotal * profile.taxPct) / 100);
      const total = round2(subtotal + tax);
      const days = creditDays.get(profile.customerId) ?? 30;
      const due = fromISO(nextRun);
      due.setDate(due.getDate() + days);
      const dueISO = toISO(due);

      // Insert with unique-violation retry (another open browser may have raced us).
      let inserted: { id: string } | null = null;
      for (let attempt = 0; attempt < 2 && !inserted; attempt++) {
        counter++;
        const invoiceNo = `INV-${String(counter).padStart(4, "0")}`;
        const { data, error } = await supabase
          .from("invoices")
          .insert({
            invoice_no: invoiceNo,
            invoice_date: nextRun,
            customer_id: profile.customerId,
            due_date: dueISO,
            subtotal,
            tax_amount: tax,
            total,
            status: dueISO < today ? "overdue" : "open",
            notes: "Auto-generated by recurring schedule",
          })
          .select("id")
          .single();
        if (!error && data) {
          inserted = data;
          generated.push({ invoice_no: invoiceNo, customerName: profile.customerName, total });
          profile.lastGenerated = invoiceNo;
        } else if (error && error.code === "23505") {
          // number taken — refresh the counter from the DB and retry once
          const { data: fresh } = await supabase.from("invoices").select("invoice_no");
          for (const row of fresh ?? []) {
            const m = /^INV-(\d+)$/.exec(row.invoice_no);
            if (m) counter = Math.max(counter, parseInt(m[1], 10));
          }
        } else {
          break; // other error — skip this profile for now, try again next app load
        }
      }
      if (!inserted) break;

      await supabase.from("invoice_items").insert(
        profile.items.map((it) => ({
          invoice_id: inserted!.id,
          description: it.description,
          qty: it.qty,
          rate: it.rate,
          amount: round2(it.qty * it.rate),
        }))
      );

      nextRun = advanceRun(nextRun, profile.frequency, profile.anchorDay);
      changed = true;
    }

    if (changed) {
      await updateProfile({ ...profile, nextRun });
    }
  }

  return generated;
}
