"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

/*
  Lands here after a customer clicks "confirm your email" (lib/customerAuth.ts
  sets emailRedirectTo to this exact page, instead of leaving Supabase to fall
  back to the project's Site URL setting, which may not match wherever this
  app is actually running).

  Supabase always verifies the token server-side before ever redirecting
  here, so the account is already confirmed by the time this page loads —
  this just needs to turn whatever Supabase attached (a `?code=`, the PKCE
  flow this app's client uses by default, or session tokens already applied
  automatically from a URL fragment) into a real session, then send the
  customer on to their invoices.
*/
function AuthCallbackInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) {
      setError("Supabase isn't configured.");
      return;
    }
    let cancelled = false;

    (async () => {
      const code = searchParams.get("code");
      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) {
          if (!cancelled) setError(exchangeError.message);
          return;
        }
      }

      // Whether it arrived as a `code` (handled above) or as URL-fragment
      // tokens (auto-applied by the client on load), a session should exist now.
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        if (!cancelled) setError("That confirmation link is invalid or has expired — try signing in, or set up your password again.");
        return;
      }

      router.replace("/portal");
    })();

    return () => {
      cancelled = true;
    };
  }, [router, searchParams]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 px-4 text-center dark:bg-slate-950">
      <img src="/verve-logo-blue.png" alt="Verve Advisory" className="h-8 w-auto dark:hidden" />
      <img src="/verve-logo-white.png" alt="Verve Advisory" className="hidden h-8 w-auto dark:block" />
      {error ? (
        <>
          <p className="max-w-sm text-sm text-red-600 dark:text-red-400">{error}</p>
          <a href="/signin" className="text-sm font-medium text-brand hover:underline dark:text-brand-300">
            Back to sign in
          </a>
        </>
      ) : (
        <p className="text-sm text-slate-500 dark:text-slate-400">Confirming your account…</p>
      )}
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={null}>
      <AuthCallbackInner />
    </Suspense>
  );
}
