"use client";

import { isConfigured } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { CustomerForm } from "@/components/CustomerForm";

export default function NewCustomerPage() {
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Add Customer" subtitle="Create a new customer record." />
      {!isConfigured ? <NotConfigured /> : <CustomerForm mode="create" />}
    </div>
  );
}
