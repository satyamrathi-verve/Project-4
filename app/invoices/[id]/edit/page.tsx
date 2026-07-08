import { isConfigured } from "@/lib/supabase";
import { NotConfigured } from "@/components/NotConfigured";
import { InvoiceForm } from "@/components/InvoiceForm";

export default function EditInvoicePage({ params }: { params: { id: string } }) {
  if (!isConfigured) {
    return (
      <div className="mx-auto max-w-5xl">
        <NotConfigured />
      </div>
    );
  }
  return <InvoiceForm invoiceId={params.id} />;
}
