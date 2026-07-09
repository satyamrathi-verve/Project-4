"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase, isConfigured } from "@/lib/supabase";
import type { Customer } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { CustomerForm } from "@/components/CustomerForm";

export default function EditCustomerPage() {
  const params = useParams<{ id: string }>();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    (async () => {
      const { data, error } = await supabase.from("customers").select("*").eq("id", params.id).single();
      if (error) {
        setError(error.message);
        return;
      }
      setCustomer(data as Customer);
    })();
  }, [params.id]);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Edit Customer" subtitle={customer ? `${customer.code} — ${customer.name}` : undefined} />

      {!isConfigured && <NotConfigured />}

      {isConfigured && error && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-6 text-red-800 dark:border-red-500/40 dark:bg-red-950/40 dark:text-red-200">
          <p className="font-semibold">Couldn&apos;t load this customer.</p>
          <p className="mt-1 text-sm">{error}</p>
        </div>
      )}

      {isConfigured && !error && !customer && <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>}

      {isConfigured && !error && customer && <CustomerForm mode="edit" initial={customer} />}
    </div>
  );
}
