-- ============================================================================
-- Migration: Customer Login — Row Level Security
-- Restricts what a logged-in customer (via Supabase Auth) can see on
-- customers / invoices / receipts to their OWN record only, matched by email.
-- The internal app never authenticates via Supabase Auth — it always hits
-- these tables as the `anon` role — so tightening the old blanket policy to
-- `anon` only does not change internal behaviour at all.
--
-- Run this in Supabase → SQL Editor → New query → paste the WHOLE file → Run.
-- Watch for the green "Success" confirmation. Re-runnable (drops/recreates
-- the new policies; the `alter policy ... to anon` lines are idempotent).
-- ============================================================================

-- 1) Narrow the existing open policy to the `anon` role only (internal app).
--    Authenticated (customer) sessions are no longer covered by this — they
--    get the new customer-scoped policies below instead.
alter policy anon_all on customers to anon;
alter policy anon_all on invoices  to anon;
alter policy anon_all on receipts  to anon;

-- 2) A logged-in customer can read only their own row in `customers`.
drop policy if exists customer_self on customers;
create policy customer_self on customers
  for select
  to authenticated
  using (email = (select auth.jwt() ->> 'email'));

-- 3) A logged-in customer can read only their own invoices.
drop policy if exists customer_own_invoices on invoices;
create policy customer_own_invoices on invoices
  for select
  to authenticated
  using (
    customer_id in (
      select id from customers where email = (select auth.jwt() ->> 'email')
    )
  );

-- 4) A logged-in customer can read only their own receipts.
drop policy if exists customer_own_receipts on receipts;
create policy customer_own_receipts on receipts
  for select
  to authenticated
  using (
    customer_id in (
      select id from customers where email = (select auth.jwt() ->> 'email')
    )
  );

-- ============================================================================
-- Not explicitly requested, but included: leaving these two tables on the old
-- open policy would mean a logged-in customer's session could still read
-- every OTHER customer's invoice line items and payment allocations via a
-- direct API call, even though our own app's UI never asks for them. This
-- closes that gap the same way as the three tables above.
-- ============================================================================

alter policy anon_all on invoice_items       to anon;
alter policy anon_all on receipt_allocations to anon;

drop policy if exists customer_own_invoice_items on invoice_items;
create policy customer_own_invoice_items on invoice_items
  for select
  to authenticated
  using (
    invoice_id in (
      select i.id from invoices i
      join customers c on c.id = i.customer_id
      where c.email = (select auth.jwt() ->> 'email')
    )
  );

drop policy if exists customer_own_receipt_allocations on receipt_allocations;
create policy customer_own_receipt_allocations on receipt_allocations
  for select
  to authenticated
  using (
    invoice_id in (
      select i.id from invoices i
      join customers c on c.id = i.customer_id
      where c.email = (select auth.jwt() ->> 'email')
    )
  );

-- Make sure PostgREST picks up the policy changes immediately.
notify pgrst, 'reload schema';
