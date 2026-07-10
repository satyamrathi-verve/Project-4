import { supabase } from "@/lib/supabase";

/*
  Customer-facing auth — real Supabase Auth (email + password), completely
  separate from the internal team's front-end-only login in lib/auth.ts.
  There is no shared table or form between the two, so an internal login can
  never be mistaken for a customer session or vice versa.

  A logged-in customer is linked to their `customers` row purely by matching
  email (their Supabase Auth email === customers.email) — enforced by the RLS
  policies in supabase/migrations/002_customer_login_rls.sql, not by any new
  column. Passwords are never stored in our schema; Supabase Auth owns that.
*/

export interface AuthResult {
  error: string | null;
  /** True once signUp/signIn actually returned a live session (false if email confirmation is pending). */
  hasSession: boolean;
}

export async function customerSignIn(email: string, password: string): Promise<AuthResult> {
  if (!supabase) return { error: "Supabase isn't configured.", hasSession: false };
  const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  return { error: error?.message ?? null, hasSession: Boolean(data.session) };
}

export async function customerSignUp(email: string, password: string): Promise<AuthResult> {
  if (!supabase) return { error: "Supabase isn't configured.", hasSession: false };
  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
    // Without this, Supabase falls back to the project's Site URL setting,
    // which may not match wherever this app actually happens to be running
    // (e.g. a forwarded Codespace port) — pointing it at the current origin
    // means the confirmation link always lands back on this exact deployment.
    options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
  });
  return { error: error?.message ?? null, hasSession: Boolean(data.session) };
}

export async function customerSignOut() {
  if (!supabase) return;
  await supabase.auth.signOut();
}

export async function getCustomerSessionEmail(): Promise<string | null> {
  if (!supabase) return null;
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.user.email ?? null;
}
