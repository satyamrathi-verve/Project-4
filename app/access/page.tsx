"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase, isConfigured } from "@/lib/supabase";
import type { Customer } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { DataTable, type Column } from "@/components/DataTable";
import { DEMO_LOGINS, getSession } from "@/lib/auth";

/*
  User & Access Management — read-only reference for who can get into this
  app. There are two completely separate access systems here, and this page
  only shows what each one actually lets us know:

  1. Internal team access (lib/auth.ts): a hardcoded demo-login list checked
     in the browser. Front-end-only, no backend, no users table (see
     CLAUDE.md) — there's nothing in a database to manage, so this is a
     reference list, not account administration.

  2. Customer portal access (lib/customerAuth.ts): real Supabase Auth
     accounts, entirely separate from the login above. This app only holds
     the public (anon) Supabase key — listing, disabling, or resetting an
     actual customer's Auth account needs the service-role key, which isn't
     available here (and shouldn't be shipped to the browser if it were).
     So this section shows *eligibility* — does the customer have an email
     on file, which is what the RLS policies in
     supabase/migrations/002_customer_login_rls.sql match a portal session
     against — not confirmed sign-up, which this app has no way to know.
*/

export default function AccessManagementPage() {
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentSession, setCurrentSession] = useState<string | null>(null);

  useEffect(() => {
    setCurrentSession(getSession());
  }, []);

  useEffect(() => {
    if (!supabase) return;
    (async () => {
      const { data, error } = await supabase.from("customers").select("*").order("name");
      if (error) {
        setError(error.message);
        return;
      }
      setCustomers(data as Customer[]);
    })();
  }, []);

  const eligibleCount = useMemo(() => (customers ?? []).filter((c) => Boolean(c.email)).length, [customers]);

  const columns: Column<Customer>[] = [
    { key: "code", header: "Code" },
    { key: "name", header: "Customer" },
    { key: "email", header: "Email", render: (r) => r.email ?? "—" },
    {
      key: "status",
      header: "Portal Access",
      sortValue: (r) => (r.email ? 1 : 0),
      filterable: true,
      filterValue: (r) => (r.email ? "Eligible" : "No email on file"),
      render: (r) =>
        r.email ? (
          <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
            Eligible
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            No email on file
          </span>
        ),
    },
  ];

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="User &amp; Access Management"
        subtitle="Who can sign in to this app — the internal team's demo logins, and which customers are eligible for portal access."
      />

      {!isConfigured && <NotConfigured />}

      {isConfigured && (
        <>
          {/* Internal team access */}
          <div className="mb-8">
            <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Internal Team Access
            </h3>
            <p className="mb-4 max-w-2xl text-xs text-slate-400 dark:text-slate-500">
              Front-end-only demo logins — no backend, no users table, so this is a reference list, not account administration.
            </p>
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left dark:border-slate-800 dark:bg-slate-800/50">
                    <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">Username</th>
                    <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">Password</th>
                    <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {DEMO_LOGINS.map((l) => (
                    <tr key={l.username} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                      <td className="px-4 py-3 font-medium text-slate-700 dark:text-slate-300">{l.username}</td>
                      <td className="px-4 py-3 font-mono text-slate-500 dark:text-slate-400">{l.password}</td>
                      <td className="px-4 py-3">
                        {currentSession === l.username ? (
                          <span className="inline-flex items-center rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand dark:bg-brand-900/30 dark:text-brand-300">
                            Currently signed in
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400 dark:text-slate-500">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Customer portal access */}
          <div>
            <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Customer Portal Access
            </h3>
            <p className="mb-4 max-w-2xl text-xs text-slate-400 dark:text-slate-500">
              Customer portal logins are real Supabase Auth accounts, managed entirely separately from the table above. This app
              only holds the public (anon) Supabase key, which can&apos;t list or manage other people&apos;s Auth accounts — that
              needs a service-role key this app doesn&apos;t have. So below is <span className="font-medium text-slate-500 dark:text-slate-400">eligibility</span>,
              not confirmed sign-up: a customer with an email on file can sign up for the portal at that email, but this page has
              no way to know whether they actually have.
            </p>

            {error && (
              <div role="alert" className="mb-4 rounded-xl border border-red-300 bg-red-50 p-6 text-red-800 dark:border-red-500/40 dark:bg-red-950/40 dark:text-red-200">
                <p className="font-semibold">Couldn&apos;t load customers.</p>
                <p className="mt-1 text-sm">{error}</p>
              </div>
            )}

            {!error && customers === null && <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>}

            {!error && customers !== null && (
              <>
                <p className="mb-3 text-xs text-slate-400 dark:text-slate-500">
                  {eligibleCount} of {customers.length} customer{customers.length === 1 ? "" : "s"} eligible (has an email on
                  file).
                </p>
                <DataTable
                  columns={columns}
                  rows={customers}
                  empty="No customers found."
                  searchPlaceholder="Search name, code, or email…"
                />
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
