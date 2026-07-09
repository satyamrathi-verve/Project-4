import { supabase } from "@/lib/supabase";

/*
  The scripted Q&A engine behind the "Ask your AR" chatbot (no AI API — free,
  instant, works offline). It loads the live AR book from Supabase, then answers
  natural-language questions by recognising:
   - entities: customer names/codes, invoice numbers (INV-0001), receipt numbers (RCP-0001)
   - time periods: "this month", "last month", month names ("in January")
   - ~25 intent families: outstanding, overdue, ageing, DSO, top debtors, best payers,
     sales/collections (totals, by month, by mode), cashflow due-soon, credit limits,
     invoice/receipt status, counts, largest/oldest, company & GL info, health summary…
  Every answer is computed from the same live data the dashboard uses.
*/

export const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

export interface ARInvoice {
  id: string;
  invoice_no: string;
  invoice_date: string;
  due_date: string;
  total: number;
  status: string; // effective status (overdue computed)
  customerName: string;
  outstanding: number;
  daysOverdue: number; // >0 when overdue
  daysToDue: number; // >0 when due in the future
}

export interface ARData {
  customers: {
    id: string;
    code: string;
    name: string;
    credit_limit: number;
    credit_days: number;
    contact_person: string | null;
    email: string | null;
    phone: string | null;
    address: string | null;
  }[];
  invoices: ARInvoice[];
  receipts: { receipt_no: string; receipt_date: string; amount: number; mode: string; customerName: string }[];
  glAccounts: { code: string; name: string; type: string }[];
  company: { name: string; address: string | null; gstin: string | null; email: string | null; phone: string | null } | null;
  remindersSent: number;
}

export async function loadARData(): Promise<ARData | null> {
  if (!supabase) return null;
  const [cust, inv, alloc, rcpt, gl, comp, rem] = await Promise.all([
    supabase.from("customers").select("id, code, name, credit_limit, credit_days, contact_person, email, phone, address"),
    supabase.from("invoices").select("id, invoice_no, invoice_date, due_date, total, status, customers(name)"),
    supabase.from("receipt_allocations").select("invoice_id, amount"),
    supabase.from("receipts").select("receipt_no, receipt_date, amount, mode, customers(name)"),
    supabase.from("gl_accounts").select("code, name, type"),
    supabase.from("company").select("name, address, gstin, email, phone").limit(1),
    supabase.from("reminder_log").select("id", { count: "exact", head: true }),
  ]);
  if (cust.error || inv.error || alloc.error || rcpt.error) return null;

  const paidByInvoice: Record<string, number> = {};
  for (const a of alloc.data ?? []) paidByInvoice[a.invoice_id] = (paidByInvoice[a.invoice_id] ?? 0) + Number(a.amount);

  const today = new Date(new Date().toDateString());
  const day = 86400000;

  const invoices: ARInvoice[] = (inv.data ?? []).map((i) => {
    const customer = Array.isArray(i.customers) ? i.customers[0] : i.customers;
    const outstanding = Math.max(0, Number(i.total) - (paidByInvoice[i.id] ?? 0));
    const due = new Date(i.due_date + "T00:00:00");
    const isOverdue = i.status !== "paid" && outstanding > 0.005 && due < today;
    return {
      id: i.id,
      invoice_no: i.invoice_no,
      invoice_date: i.invoice_date,
      due_date: i.due_date,
      total: Number(i.total),
      status: isOverdue ? "overdue" : i.status,
      customerName: (customer as { name?: string } | null)?.name ?? "—",
      outstanding,
      daysOverdue: isOverdue ? Math.round((today.getTime() - due.getTime()) / day) : 0,
      daysToDue: due >= today ? Math.round((due.getTime() - today.getTime()) / day) : 0,
    };
  });

  return {
    customers: (cust.data ?? []).map((c) => ({ ...c, credit_limit: Number(c.credit_limit), credit_days: Number(c.credit_days) })),
    invoices,
    receipts: (rcpt.data ?? []).map((r) => {
      const customer = Array.isArray(r.customers) ? r.customers[0] : r.customers;
      return {
        receipt_no: r.receipt_no,
        receipt_date: r.receipt_date,
        amount: Number(r.amount),
        mode: r.mode,
        customerName: (customer as { name?: string } | null)?.name ?? "—",
      };
    }),
    glAccounts: gl.data ?? [],
    company: comp.data?.[0] ?? null,
    remindersSent: rem.count ?? 0,
  };
}

/* ---------- helpers ---------- */

const fmtD = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const list = (items: string[]) => items.join("; ");
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// Words too generic to identify a customer on their own.
const GENERIC_TOKENS = new Set([
  "pvt", "ltd", "llp", "co", "the", "and", "of", "house", "works", "group",
  "media", "foods", "agro", "software", "solutions", "exports", "india",
]);

function findCustomer(q: string, customers: ARData["customers"]) {
  let best: { c: ARData["customers"][number]; score: number } | null = null;
  for (const c of customers) {
    let score = 0;
    const nameLower = c.name.toLowerCase();
    if (q.includes(nameLower)) score += 5;
    if (q.includes(c.code.toLowerCase())) score += 5;
    for (const token of nameLower.split(/\s+/)) {
      if (token.length >= 4 && !GENERIC_TOKENS.has(token) && new RegExp(`\\b${token}\\b`).test(q)) score += 2;
    }
    if (score > 0 && (!best || score > best.score)) best = { c, score };
  }
  return best?.c ?? null;
}

interface Period {
  label: string;
  contains: (iso: string) => boolean;
}

function parsePeriod(q: string): Period | null {
  const now = new Date();
  const monthOf = (y: number, m: number, label: string): Period => ({
    label,
    contains: (iso) => {
      const d = new Date(iso + "T00:00:00");
      return d.getFullYear() === y && d.getMonth() === m;
    },
  });
  if (/\bthis month\b/.test(q)) return monthOf(now.getFullYear(), now.getMonth(), "this month");
  if (/\blast month\b/.test(q)) {
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return monthOf(d.getFullYear(), d.getMonth(), "last month");
  }
  const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  for (let m = 0; m < 12; m++) {
    const re = new RegExp(`\\b${months[m].slice(0, 3)}(?:${months[m].slice(3)})?\\b`);
    if (re.test(q)) {
      const year = m > now.getMonth() ? now.getFullYear() - 1 : now.getFullYear(); // most recent occurrence
      return monthOf(year, m, `${months[m][0].toUpperCase()}${months[m].slice(1)} ${year}`);
    }
  }
  return null;
}

/* ---------- the answer engine ---------- */

export function answerQuestion(question: string, d: ARData): string {
  const q = question.toLowerCase().replace(/[?!.,;:'"]/g, " ").replace(/\s+/g, " ").trim();
  const has = (...words: string[]) => words.some((w) => q.includes(w));

  // Shared aggregates
  const unpaid = d.invoices.filter((i) => i.outstanding > 0.005);
  const overdue = unpaid.filter((i) => i.status === "overdue");
  const totalOutstanding = unpaid.reduce((s, i) => s + i.outstanding, 0);
  const totalBilled = d.invoices.reduce((s, i) => s + i.total, 0);
  const totalCollected = d.receipts.reduce((s, r) => s + r.amount, 0);
  const totalOverdue = overdue.reduce((s, i) => s + i.outstanding, 0);

  const outstandingByCustomer = new Map<string, number>();
  for (const i of unpaid) outstandingByCustomer.set(i.customerName, (outstandingByCustomer.get(i.customerName) ?? 0) + i.outstanding);
  const debtorsRanked = Array.from(outstandingByCustomer.entries()).sort((a, b) => b[1] - a[1]);

  const capabilities = `Try asking about: total outstanding · overdue invoices · ageing buckets · top debtors · who to chase · best payers · sales or collections (also "this month" / "in May") · payment modes · expected cash this week · DSO · credit limits · a customer ("How much does Nimbus owe?") · an invoice ("status of INV-0007") · a receipt ("RCP-0004") · company info · or just "summary".`;

  // 0. Greetings / help / identity
  if (/^(hi|hello|hey|yo|namaste)\b/.test(q) && q.length < 25) {
    return `Hello! I'm Aria, your AR assistant. Right now the books show ${d.customers.length} customers, ${plural(d.invoices.length, "invoice")} and ${inr.format(totalOutstanding)} outstanding. ${capabilities}`;
  }
  if (has("who are you", "your name", "what are you", "about you")) {
    return `I'm Aria — the AR Intelligent Assistant built into this app. I answer questions straight from the live books, instantly. ${capabilities}`;
  }
  if (has("thank", "thanks", "great", "awesome", "nice")) {
    return `Happy to help! Ask me anything else about the books whenever you need.`;
  }
  if (has("help", "what can you", "what can i ask", "what do you know")) return capabilities;

  // 1. Specific invoice: "INV-0007", "invoice 7"
  const invMatch = q.match(/\binv[-. ]?0*(\d{1,4})\b/) ?? q.match(/\binvoice (?:no |number |#)?0*(\d{1,4})\b/);
  if (invMatch) {
    const no = `INV-${invMatch[1].padStart(4, "0")}`;
    const i = d.invoices.find((x) => x.invoice_no === no);
    if (!i) return `I can't find ${no} in the books. Invoice numbers run ${d.invoices[0]?.invoice_no ?? "—"} to ${d.invoices[d.invoices.length - 1]?.invoice_no ?? "—"}.`;
    const paid = i.total - i.outstanding;
    return `${i.invoice_no} — ${i.customerName}: billed ${inr.format(i.total)} on ${fmtD(i.invoice_date)}, due ${fmtD(i.due_date)}. Status: ${i.status.toUpperCase()}. ${
      paid > 0.005 ? `Received ${inr.format(paid)}, ` : ""
    }outstanding ${inr.format(i.outstanding)}${i.daysOverdue > 0 ? ` — ${i.daysOverdue} days overdue` : i.daysToDue > 0 && i.outstanding > 0.005 ? ` — due in ${plural(i.daysToDue, "day")}` : ""}.`;
  }

  // 2. Specific receipt: "RCP-0004"
  const rcptMatch = q.match(/\brcp[-. ]?0*(\d{1,4})\b/) ?? q.match(/\breceipt (?:no |number |#)?0*(\d{1,4})\b/);
  if (rcptMatch) {
    const no = `RCP-${rcptMatch[1].padStart(4, "0")}`;
    const r = d.receipts.find((x) => x.receipt_no === no);
    if (!r) return `I can't find receipt ${no} in the books.`;
    return `${r.receipt_no}: received ${inr.format(r.amount)} from ${r.customerName} on ${fmtD(r.receipt_date)} via ${r.mode.toUpperCase()}.`;
  }

  // 3. Customer-specific questions
  const cust = findCustomer(q, d.customers);
  if (cust) {
    const theirInv = d.invoices.filter((i) => i.customerName === cust.name);
    const theirUnpaid = theirInv.filter((i) => i.outstanding > 0.005);
    const theirOverdue = theirUnpaid.filter((i) => i.status === "overdue");
    const owed = theirUnpaid.reduce((s, i) => s + i.outstanding, 0);
    const billed = theirInv.reduce((s, i) => s + i.total, 0);
    const theirReceipts = d.receipts.filter((r) => r.customerName === cust.name);
    const collected = theirReceipts.reduce((s, r) => s + r.amount, 0);
    const overLimit = cust.credit_limit > 0 && owed > cust.credit_limit;

    if (has("contact", "email", "phone", "number", "address", "reach", "call")) {
      return `${cust.name} (${cust.code}) — contact: ${cust.contact_person ?? "—"}, ${cust.email ?? "no email"}, ${cust.phone ?? "no phone"}${cust.address ? `, ${cust.address}` : ""}.`;
    }
    if (has("credit", "limit", "terms")) {
      return `${cust.name} has a credit limit of ${inr.format(cust.credit_limit)} with ${cust.credit_days}-day terms. Current outstanding is ${inr.format(owed)} — ${
        overLimit ? `OVER their limit by ${inr.format(owed - cust.credit_limit)}. Consider holding further credit.` : `within limit (${inr.format(cust.credit_limit - owed)} headroom).`
      }`;
    }
    if (has("overdue", "late", "chase")) {
      if (!theirOverdue.length) return `${cust.name} has nothing overdue${owed > 0 ? ` — ${inr.format(owed)} is outstanding but not yet due` : " and nothing outstanding"}.`;
      return `${cust.name} has ${plural(theirOverdue.length, "overdue invoice")} worth ${inr.format(theirOverdue.reduce((s, i) => s + i.outstanding, 0))}: ${list(
        theirOverdue.map((i) => `${i.invoice_no} (${inr.format(i.outstanding)}, ${i.daysOverdue}d late)`)
      )}.`;
    }
    if (has("invoices", "invoice list", "list")) {
      const recent = theirInv.slice().sort((a, b) => (a.invoice_date < b.invoice_date ? 1 : -1)).slice(0, 8);
      return `${cust.name} has ${plural(theirInv.length, "invoice")} totalling ${inr.format(billed)}. Recent: ${list(recent.map((i) => `${i.invoice_no} ${inr.format(i.total)} (${i.status})`))}.`;
    }
    if (has("paid", "payment", "receipt", "collected", "received")) {
      if (!theirReceipts.length) return `No payments received from ${cust.name} yet. They owe ${inr.format(owed)}.`;
      const recent = theirReceipts.slice().sort((a, b) => (a.receipt_date < b.receipt_date ? 1 : -1)).slice(0, 5);
      return `${cust.name} has paid ${inr.format(collected)} across ${plural(theirReceipts.length, "receipt")}. Recent: ${list(recent.map((r) => `${r.receipt_no} ${inr.format(r.amount)} on ${fmtD(r.receipt_date)}`))}.`;
    }
    if (has("billed", "sales", "revenue", "business")) {
      return `We've billed ${cust.name} ${inr.format(billed)} across ${plural(theirInv.length, "invoice")}; they've paid ${inr.format(collected)} and owe ${inr.format(owed)}.`;
    }
    // default customer card / statement
    return `${cust.name} (${cust.code}): billed ${inr.format(billed)} across ${plural(theirInv.length, "invoice")}, paid ${inr.format(collected)}, outstanding ${inr.format(owed)}${
      theirOverdue.length ? ` — ${plural(theirOverdue.length, "invoice")} overdue (oldest ${Math.max(...theirOverdue.map((i) => i.daysOverdue))}d late)` : owed > 0 ? ", nothing overdue yet" : " — fully settled"
    }.${overLimit ? ` ⚠ Over their ${inr.format(cust.credit_limit)} credit limit.` : ""}`;
  }

  const period = parsePeriod(q);

  // 4. Over credit limit
  if (has("over limit", "credit limit", "over their limit", "credit breach", "stop shipping", "credit risk", "blacklist")) {
    const breaches = d.customers
      .map((c) => ({ c, owed: outstandingByCustomer.get(c.name) ?? 0 }))
      .filter((x) => x.c.credit_limit > 0 && x.owed > x.c.credit_limit);
    if (!breaches.length) return `No customer is over their credit limit right now. Highest exposure: ${debtorsRanked[0]?.[0] ?? "—"} at ${inr.format(debtorsRanked[0]?.[1] ?? 0)}.`;
    return `${plural(breaches.length, "customer")} over their credit limit: ${list(
      breaches.map((x) => `${x.c.name} owes ${inr.format(x.owed)} vs limit ${inr.format(x.c.credit_limit)} (over by ${inr.format(x.owed - x.c.credit_limit)})`)
    )}. Consider holding further credit for them.`;
  }

  // 5. Ageing buckets
  if (has("ageing", "aging", "bucket", "age of", "how old")) {
    const b = { notDue: 0, d0_30: 0, d31_60: 0, d61_90: 0, d90p: 0 };
    for (const i of unpaid) {
      if (i.daysOverdue <= 0) b.notDue += i.outstanding;
      else if (i.daysOverdue <= 30) b.d0_30 += i.outstanding;
      else if (i.daysOverdue <= 60) b.d31_60 += i.outstanding;
      else if (i.daysOverdue <= 90) b.d61_90 += i.outstanding;
      else b.d90p += i.outstanding;
    }
    return `Ageing of ${inr.format(totalOutstanding)} outstanding — Not due: ${inr.format(b.notDue)} · 0–30 days: ${inr.format(b.d0_30)} · 31–60: ${inr.format(b.d31_60)} · 61–90: ${inr.format(b.d61_90)} · 90+: ${inr.format(b.d90p)}. The 61+ buckets (${inr.format(b.d61_90 + b.d90p)}) need urgent chasing.`;
  }

  // 6. DSO
  if (has("dso", "days sales outstanding", "collection period", "how long to collect")) {
    const dso = totalBilled > 0 ? Math.round((totalOutstanding / totalBilled) * 90) : 0;
    return `DSO is roughly ${dso} days — on average that's how long money stays uncollected after billing (outstanding ÷ ~90-day billing × 90). Lower is healthier; the biggest drag is ${debtorsRanked[0]?.[0] ?? "—"} (${inr.format(debtorsRanked[0]?.[1] ?? 0)} outstanding).`;
  }

  // 7. Cashflow / due soon
  if (has("cashflow", "cash flow", "expected", "due this week", "due next week", "due soon", "coming in", "inflow", "due this month", "collect this")) {
    const within = (lo: number, hi: number) => unpaid.filter((i) => i.daysToDue >= lo && i.daysToDue <= hi && i.daysOverdue === 0);
    const nextWeek = has("next week") ? within(8, 14) : within(0, 7);
    const label = has("next week") ? "next week" : has("month") ? "this month" : "this week";
    const dueSet = has("month") ? unpaid.filter((i) => i.daysOverdue === 0 && new Date(i.due_date + "T00:00:00").getMonth() === new Date().getMonth()) : nextWeek;
    const expected = dueSet.reduce((s, i) => s + i.outstanding, 0);
    return `Expected ${label}: ${inr.format(expected)} from ${plural(dueSet.length, "invoice")} falling due${
      dueSet.length ? ` (${list(dueSet.slice(0, 5).map((i) => `${i.invoice_no} ${i.customerName} ${inr.format(i.outstanding)} due ${fmtD(i.due_date)}`))})` : ""
    }. On top of that, ${inr.format(totalOverdue)} is already overdue and collectible now if chased.`;
  }

  // 8. Who to chase / priority
  if (has("chase", "follow up", "followup", "priority", "remind", "call first", "focus")) {
    const worst = overdue.slice().sort((a, b) => b.outstanding * (1 + b.daysOverdue / 30) - a.outstanding * (1 + a.daysOverdue / 30)).slice(0, 5);
    if (!worst.length) return `Nothing is overdue — no chasing needed. ${inr.format(totalOutstanding)} outstanding is all within terms.`;
    return `Chase these first (by amount and how stale): ${list(worst.map((i, k) => `${k + 1}. ${i.customerName} — ${i.invoice_no}, ${inr.format(i.outstanding)}, ${i.daysOverdue}d late`))}. ${
      d.remindersSent ? `${plural(d.remindersSent, "reminder")} have been sent so far.` : ""
    }`;
  }

  // 9. Overdue (general)
  if (has("overdue", "late", "past due", "delayed", "hasn t paid", "hasnt paid", "not paid")) {
    if (!overdue.length) return `Nothing is overdue right now — all ${inr.format(totalOutstanding)} outstanding is within terms. 🎉`;
    if (has("how many", "count", "number of")) return `${plural(overdue.length, "invoice")} are overdue, worth ${inr.format(totalOverdue)} across ${new Set(overdue.map((i) => i.customerName)).size} customers.`;
    if (has("oldest", "longest", "worst")) {
      const oldest = overdue.slice().sort((a, b) => b.daysOverdue - a.daysOverdue)[0];
      return `Oldest overdue: ${oldest.invoice_no} from ${oldest.customerName} — ${inr.format(oldest.outstanding)}, ${oldest.daysOverdue} days late (was due ${fmtD(oldest.due_date)}).`;
    }
    const top = overdue.slice().sort((a, b) => b.outstanding - a.outstanding).slice(0, 5);
    return `${plural(overdue.length, "overdue invoice")} worth ${inr.format(totalOverdue)}. Biggest: ${list(top.map((i) => `${i.invoice_no} ${i.customerName} ${inr.format(i.outstanding)} (${i.daysOverdue}d)`))}.`;
  }

  // 10. Rankings
  if (has("top debtor", "who owes", "owes the most", "owes us most", "biggest debtor", "most outstanding", "top 5", "top five", "debtors")) {
    return `Top debtors by outstanding: ${list(debtorsRanked.slice(0, 5).map(([n, v], k) => `${k + 1}. ${n} — ${inr.format(v)}`))}. Together the top 5 hold ${inr.format(
      debtorsRanked.slice(0, 5).reduce((s, [, v]) => s + v, 0)
    )} of ${inr.format(totalOutstanding)} total.`;
  }
  if (has("top customer", "best customer", "biggest customer", "most sales", "highest sales", "by sales", "by revenue", "by billing")) {
    const billedBy = new Map<string, number>();
    for (const i of d.invoices) billedBy.set(i.customerName, (billedBy.get(i.customerName) ?? 0) + i.total);
    const ranked = Array.from(billedBy.entries()).sort((a, b) => b[1] - a[1]);
    return `Top customers by billing: ${list(ranked.slice(0, 5).map(([n, v], k) => `${k + 1}. ${n} — ${inr.format(v)}`))}.`;
  }
  if (has("best payer", "good payer", "paid up", "settled", "who has paid", "reliable")) {
    const clean = d.customers.filter((c) => {
      const theirs = d.invoices.filter((i) => i.customerName === c.name);
      return theirs.length > 0 && theirs.every((i) => i.outstanding <= 0.005 || i.status !== "overdue");
    });
    const fullySettled = d.customers.filter((c) => {
      const theirs = d.invoices.filter((i) => i.customerName === c.name);
      return theirs.length > 0 && theirs.every((i) => i.outstanding <= 0.005);
    });
    return fullySettled.length
      ? `Fully settled customers: ${list(fullySettled.map((c) => c.name))}. Also in good standing (nothing overdue): ${list(clean.filter((c) => !fullySettled.includes(c)).map((c) => c.name)) || "—"}.`
      : `No customer is fully settled, but these have nothing overdue: ${list(clean.map((c) => c.name)) || "none"}.`;
  }

  // 11. Largest / smallest / latest invoices
  if (has("largest invoice", "biggest invoice", "highest invoice")) {
    const big = d.invoices.slice().sort((a, b) => b.total - a.total)[0];
    return `Largest invoice: ${big.invoice_no} to ${big.customerName} for ${inr.format(big.total)} (${big.status}, dated ${fmtD(big.invoice_date)}).`;
  }
  if (has("smallest invoice", "lowest invoice")) {
    const small = d.invoices.slice().sort((a, b) => a.total - b.total)[0];
    return `Smallest invoice: ${small.invoice_no} to ${small.customerName} for ${inr.format(small.total)} (${small.status}).`;
  }
  if (has("recent invoice", "latest invoice", "last invoice", "newest invoice")) {
    const recent = d.invoices.slice().sort((a, b) => (a.invoice_date < b.invoice_date ? 1 : -1)).slice(0, 5);
    return `Most recent invoices: ${list(recent.map((i) => `${i.invoice_no} ${i.customerName} ${inr.format(i.total)} on ${fmtD(i.invoice_date)} (${i.status})`))}.`;
  }
  if (has("recent payment", "latest payment", "last payment", "recent receipt", "latest receipt")) {
    const recent = d.receipts.slice().sort((a, b) => (a.receipt_date < b.receipt_date ? 1 : -1)).slice(0, 5);
    return `Most recent payments: ${list(recent.map((r) => `${r.receipt_no} ${inr.format(r.amount)} from ${r.customerName} on ${fmtD(r.receipt_date)} (${r.mode.toUpperCase()})`))}.`;
  }

  // 12. Payment modes
  if (has("payment mode", "upi", "cheque", "neft", "cash", "how do they pay", "mode of payment", "pay us", "customers pay", "usually pay", "payment method", "modes")) {
    const byMode = new Map<string, { n: number; amt: number }>();
    for (const r of d.receipts) {
      const row = byMode.get(r.mode) ?? { n: 0, amt: 0 };
      row.n += 1;
      row.amt += r.amount;
      byMode.set(r.mode, row);
    }
    return `Collections by mode: ${list(Array.from(byMode.entries()).map(([m, v]) => `${m.toUpperCase()} — ${inr.format(v.amt)} (${plural(v.n, "receipt")})`))}. Total collected ${inr.format(totalCollected)}.`;
  }

  // 13. Collections (with optional period)
  if (has("collected", "collections", "received", "receipts total", "money in", "how much came in", "recovery")) {
    if (period) {
      const inPeriod = d.receipts.filter((r) => period.contains(r.receipt_date));
      return `Collected ${period.label}: ${inr.format(inPeriod.reduce((s, r) => s + r.amount, 0))} across ${plural(inPeriod.length, "receipt")}. All-time collected: ${inr.format(totalCollected)}.`;
    }
    const rate = totalBilled > 0 ? Math.round((totalCollected / totalBilled) * 100) : 0;
    return `Total collected: ${inr.format(totalCollected)} across ${plural(d.receipts.length, "receipt")} — a ${rate}% collection rate on ${inr.format(totalBilled)} billed. ${inr.format(totalOutstanding)} is still out there.`;
  }

  // 14. Sales / billing (with optional period)
  if (has("sales", "billed", "billing", "revenue", "invoiced", "turnover")) {
    if (period) {
      const inPeriod = d.invoices.filter((i) => period.contains(i.invoice_date));
      return `Billed ${period.label}: ${inr.format(inPeriod.reduce((s, i) => s + i.total, 0))} across ${plural(inPeriod.length, "invoice")}. All-time billed: ${inr.format(totalBilled)}.`;
    }
    if (has("average", "avg")) return `Average invoice value: ${inr.format(totalBilled / Math.max(1, d.invoices.length))} across ${plural(d.invoices.length, "invoice")}.`;
    if (has("month", "trend")) {
      const byMonth = new Map<string, number>();
      for (const i of d.invoices) {
        const dte = new Date(i.invoice_date + "T00:00:00");
        const key = dte.toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
        byMonth.set(key, (byMonth.get(key) ?? 0) + i.total);
      }
      return `Billing by month: ${list(Array.from(byMonth.entries()).map(([m, v]) => `${m} — ${inr.format(v)}`))}.`;
    }
    return `Total billed: ${inr.format(totalBilled)} across ${plural(d.invoices.length, "invoice")} to ${d.customers.length} customers. Collected ${inr.format(totalCollected)}, outstanding ${inr.format(totalOutstanding)}.`;
  }

  // 15. Outstanding / receivables (general)
  if (has("outstanding", "receivable", "owed to us", "owed", "pending amount", "balance", "how much do they owe", "total due", "book size", "exposure")) {
    return `Total outstanding: ${inr.format(totalOutstanding)} across ${plural(unpaid.length, "unpaid invoice")} from ${outstandingByCustomer.size} customers. ${inr.format(totalOverdue)} of it (${
      totalOutstanding ? Math.round((totalOverdue / totalOutstanding) * 100) : 0
    }%) is already overdue. Biggest debtor: ${debtorsRanked[0]?.[0] ?? "—"} at ${inr.format(debtorsRanked[0]?.[1] ?? 0)}.`;
  }

  // 16. Status breakdown / counts
  if (has("status", "breakdown", "how many paid", "how many open", "how many partial", "split")) {
    const byStatus = new Map<string, number>();
    for (const i of d.invoices) byStatus.set(i.status, (byStatus.get(i.status) ?? 0) + 1);
    return `Invoice status: ${list(Array.from(byStatus.entries()).map(([s, n]) => `${s} — ${n}`))} (of ${d.invoices.length} total).`;
  }
  if (has("how many customer", "customer count", "number of customer")) {
    return `${d.customers.length} customers on the book. ${outstandingByCustomer.size} of them currently owe money.`;
  }
  if (has("how many invoice", "invoice count", "number of invoice")) {
    return `${d.invoices.length} invoices raised in total — ${unpaid.length} still unpaid, ${overdue.length} overdue.`;
  }
  if (has("list customers", "all customers", "customer list", "who are our customers")) {
    return `Customers (${d.customers.length}): ${list(d.customers.map((c) => c.name))}.`;
  }

  // 17. Reminders
  if (has("reminder", "email sent", "chased already", "follow-ups sent")) {
    return d.remindersSent
      ? `${plural(d.remindersSent, "payment reminder")} have been sent (see the AR Followup screen for the log).`
      : `No payment reminders have been sent yet — the AR Followup screen can shoot them for all overdue invoices in one go.`;
  }

  // 18. Company / GL
  if (has("company", "gstin", "our address", "who are we", "verve advisory")) {
    const c = d.company;
    return c ? `${c.name}${c.address ? `, ${c.address}` : ""}${c.gstin ? ` · GSTIN ${c.gstin}` : ""}${c.email ? ` · ${c.email}` : ""}${c.phone ? ` · ${c.phone}` : ""}.` : `Company details aren't loaded.`;
  }
  if (has("gl account", "ledger", "chart of accounts", "accounts list")) {
    return `GL accounts (${d.glAccounts.length}): ${list(d.glAccounts.map((g) => `${g.code} ${g.name} (${g.type})`))}.`;
  }

  // 19. Health summary
  if (has("summary", "overview", "health", "how are we doing", "how is the book", "snapshot", "kpi", "dashboard")) {
    const dso = totalBilled > 0 ? Math.round((totalOutstanding / totalBilled) * 90) : 0;
    return `AR snapshot: ${d.customers.length} customers, ${plural(d.invoices.length, "invoice")} billed ${inr.format(totalBilled)}. Collected ${inr.format(totalCollected)} (${
      totalBilled ? Math.round((totalCollected / totalBilled) * 100) : 0
    }%), outstanding ${inr.format(totalOutstanding)}, of which ${inr.format(totalOverdue)} overdue across ${plural(overdue.length, "invoice")}. DSO ≈ ${dso} days. Top debtor: ${debtorsRanked[0]?.[0] ?? "—"} (${inr.format(
      debtorsRanked[0]?.[1] ?? 0
    )}).`;
  }

  // Default — didn't recognise the question
  return `I didn't quite catch that one — I'm best with questions about the books. ${capabilities}`;
}

/* Compact text snapshot for an (optional) AI answerer. */
export function buildContext(d: ARData): string {
  const unpaid = d.invoices.filter((i) => i.outstanding > 0.005);
  const overdue = unpaid.filter((i) => i.status === "overdue");
  return [
    `Snapshot: ${new Date().toDateString()}`,
    `KPIs: ${d.customers.length} customers, ${d.invoices.length} invoices, billed ${inr.format(d.invoices.reduce((s, i) => s + i.total, 0))}, collected ${inr.format(
      d.receipts.reduce((s, r) => s + r.amount, 0)
    )}, outstanding ${inr.format(unpaid.reduce((s, i) => s + i.outstanding, 0))}, overdue ${overdue.length} worth ${inr.format(overdue.reduce((s, i) => s + i.outstanding, 0))}.`,
    ``,
    `CUSTOMERS:`,
    ...d.customers.map((c) => `${c.code} ${c.name} | limit ${inr.format(c.credit_limit)} | ${c.credit_days}d terms`),
    ``,
    `INVOICES:`,
    ...d.invoices.map(
      (i) =>
        `${i.invoice_no} | ${i.customerName} | ${i.invoice_date} due ${i.due_date} | ${inr.format(i.total)} | ${i.status}${i.outstanding > 0.005 ? ` | out ${inr.format(i.outstanding)}` : ""}${
          i.daysOverdue ? ` | ${i.daysOverdue}d late` : ""
        }`
    ),
  ].join("\n");
}
