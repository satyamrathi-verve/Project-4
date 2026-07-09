-- ============================================================================
-- Migration: Customer Master enhancements (consolidated)
-- Adds GST/compliance, banking, MSME, export and status fields to `customers`.
-- Safe to run on a project that already has seeded data: every new column
-- gets a default so existing rows keep working, and billing_address backfills
-- from the legacy single-line `address` column before being made required.
--
-- Run this in Supabase → SQL Editor → New query → paste the WHOLE file → Run.
-- Watch for the green "Success" confirmation (or a red error banner) at the
-- bottom of the editor — don't assume it worked without seeing that. Re-runnable.
-- ============================================================================

alter table customers
  add column if not exists registration_type text not null default 'REGULAR'
    check (registration_type in ('REGULAR','COMPOSITION','UNREGISTERED','SEZ')),
  add column if not exists billing_address  text,
  add column if not exists shipping_address text,
  add column if not exists state            text,
  add column if not exists state_code       text,
  add column if not exists place_of_supply  text,
  add column if not exists tds_applicable   boolean not null default false,
  add column if not exists tds_section      text,
  add column if not exists tcs_applicable   boolean not null default false,
  add column if not exists msme_status      text not null default 'NA'
    check (msme_status in ('MICRO','SMALL','MEDIUM','NA')),
  add column if not exists udyam_number     text,
  add column if not exists bank_account_no  text,
  add column if not exists bank_ifsc        text,
  add column if not exists currency         text not null default 'INR',
  add column if not exists is_export_client boolean not null default false,
  add column if not exists lut_number       text,
  add column if not exists status           text not null default 'ACTIVE'
    check (status in ('ACTIVE','INACTIVE','BLACKLISTED')),
  add column if not exists remarks          text;

-- Backfill billing_address from the legacy `address` column, then enforce
-- not-null now that every existing row is guaranteed to have a value.
update customers set billing_address = coalesce(billing_address, address, '') where billing_address is null;
alter table customers alter column billing_address set default '';
alter table customers alter column billing_address set not null;

-- Make sure PostgREST picks up the new columns immediately instead of
-- waiting for its next automatic schema-cache refresh.
notify pgrst, 'reload schema';
