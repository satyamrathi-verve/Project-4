-- ============================================================================
-- Migration: Cash Flow Projections
-- A persisted forecasting ledger — one row per expected cash-flow event
-- (an invoice's predicted collection date/amount, or a manual projection not
-- tied to any single invoice). This is what lets forecast-vs-actual accuracy
-- and aging be tracked over time, which a live-only computation can't do
-- (the existing Cashflow Projection screen at app/cashflow/page.tsx computes
-- everything on the fly from invoices + receipt_allocations and has no
-- memory of past predictions — this table is a different, additional data
-- model, not a replacement for that screen's current data source).
--
-- Run this in Supabase → SQL Editor → New query → paste the WHOLE file → Run.
-- Watch for the green "Success" confirmation. Safe to re-run (uses
-- `if not exists` / `drop policy if exists`).
-- ============================================================================

create table if not exists cash_flow_projections (
  id                 uuid primary key default gen_random_uuid(),
  customer_id        uuid not null references customers(id) on delete cascade,
  invoice_id         uuid references invoices(id) on delete set null,
  expected_amount    numeric(14,2) not null,
  expected_date      date not null,
  actual_amount      numeric(14,2),
  actual_date        date,
  aging_bucket       text not null default 'current'
                       check (aging_bucket in ('current','1-30','31-60','60+')),
  is_manual_override boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists cash_flow_projections_customer_id_idx
  on cash_flow_projections (customer_id);

create index if not exists cash_flow_projections_expected_date_idx
  on cash_flow_projections (expected_date);

-- Row-level security: same open-access-for-the-event pattern as every other
-- table (anon_all — see supabase/seed.sql), so the internal app's anon-key
-- access keeps working unchanged. This table is NOT customer-scoped by this
-- migration — if customers should ever see their own projections directly
-- through the portal (002_customer_login_rls.sql), that needs its own
-- customer_own_* policy added alongside this one, not assumed here.
alter table cash_flow_projections enable row level security;

drop policy if exists anon_all on cash_flow_projections;
create policy anon_all on cash_flow_projections
  for all to anon, authenticated using (true) with check (true);

notify pgrst, 'reload schema';
