/*
  Mirrors the `cash_flow_projections` table (see
  supabase/migrations/003_cash_flow_projections.sql). Every other table's
  types live in lib/types.ts — this sits in its own types/ folder per this
  task's spec; if that should instead just be added to lib/types.ts for
  consistency with the rest of the repo, that's an easy move later.
*/

export type AgingBucket = "current" | "1-30" | "31-60" | "60+";

export interface CashFlowProjection {
  id: string;
  customer_id: string;
  invoice_id: string | null;
  expected_amount: number;
  expected_date: string; // YYYY-MM-DD
  actual_amount: number | null;
  actual_date: string | null; // YYYY-MM-DD
  aging_bucket: AgingBucket;
  is_manual_override: boolean;
  created_at: string;
  updated_at: string;
}
