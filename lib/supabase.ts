import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/*
  The configured Supabase client for this team's project. The URL + anon key live
  in .env.local (already filled in for you). Import `supabase` anywhere and read/
  write the existing tables — never create or alter tables.

  Uses @supabase/ssr's createBrowserClient (not plain createClient) so a
  customer's session is stored in a cookie, not just localStorage —
  middleware.ts reads that cookie server-side to guard /portal and keep a
  customer session off internal pages. The internal app never calls
  supabase.auth.* (lib/auth.ts is a separate, front-end-only localStorage
  flag), so this switch changes nothing about how internal screens behave.

  If the env vars are missing it returns null so the app still renders with a
  friendly "connect Supabase" notice instead of crashing.
*/

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isConfigured = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = isConfigured
  ? createBrowserClient(url as string, anonKey as string)
  : null;
