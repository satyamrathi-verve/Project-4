"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, isConfigured } from "@/lib/supabase";
import { customerSignOut } from "@/lib/customerAuth";
import { NotConfigured } from "@/components/NotConfigured";
import { DataTable, type Column } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { ThemeToggle } from "@/components/ThemeToggle";
import { formatCurrency, formatDate } from "@/lib/format";
import { buildAllocationMap, paidAmount, balanceDue, displayStatus } from "@/lib/invoice";
import { daysOverdue } from "@/components/StatusPill";
import type { Customer, Invoice, ReceiptAllocation } from "@/lib/types";

/*
  Customer-facing "My Invoices" — read-only. A customer is linked to their
  `customers` row purely by matching Supabase Auth email (see
  lib/customerAuth.ts). The query below asks for ALL customers/invoices, but
  Postgres RLS (supabase/migrations/002_customer_login_rls.sql) is what
  actually narrows the result to just their own row(s) — this app-level
  shape is a convenience, not the security boundary. No edit/delete actions,
  no links to any internal screen, no nav — this page is the entire app for
  a customer session.
*/

interface InvoiceRow {
  id: string;
  invoice_no: string;
  invoice_date: string;
  due_date: string;
  total: number;
  balance: number;
  status: Invoice["status"];
}

export default function CustomerPortalPage() {
  const router = useRouter();
  const [customer, setCustomer] = useState<Customer | null | undefined>(undefined); // undefined = loading, null = none found
  const [rows, setRows] = useState<InvoiceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const columns: Column<InvoiceRow>[] = [
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
              <div className="mt-6">
                {rows === null ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>
                ) : (
                  <DataTable columns={columns} rows={rows} empty="No invoices on your account yet." />
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
