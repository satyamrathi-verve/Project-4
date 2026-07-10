"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { getSession, signOut } from "@/lib/auth";
import { Nav } from "@/components/Nav";
import { ThemeToggle } from "@/components/ThemeToggle";
import { GlobalSearch } from "@/components/GlobalSearch";
import { AskAria } from "@/components/AskAria";
import { Toaster, toast } from "@/components/Toast";
import { ScreenIcon } from "@/components/icons";
import { runDueRecurring } from "@/lib/recurring";
import { inr } from "@/lib/format";

/* Hides the app (nav + header) until signed in. The Sign In page renders
   full-screen with no chrome; every other route needs a session or gets bounced. */
// Run the recurring-invoice generator once per app load (not per route change).
let recurringRan = false;

export function AuthGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    if (!signedIn || recurringRan) return;
    recurringRan = true;
    runDueRecurring()
      .then((generated) => {
        for (const g of generated) toast(`Recurring: ${g.invoice_no} raised for ${g.customerName} (${inr.format(g.total)})`);
      })
      .catch(() => {
        /* non-fatal — will try again on next app load */
      });
  }, [signedIn]);

  // Sign-in is public chrome-free; the customer portal and the email-
  // confirmation landing page both have their own Supabase Auth handling —
  // none of the three should be gated by (or redirected because of) the
  // internal, localStorage-only session below.
  const isBypassRoute =
    pathname === "/signin" || pathname.startsWith("/portal") || pathname.startsWith("/auth/callback");

  useEffect(() => {
    if (isBypassRoute) return;
    const session = getSession();
    setSignedIn(Boolean(session));
    setReady(true);
    if (!session) {
      router.replace("/signin");
    }
  }, [pathname, router, isBypassRoute]);

  if (isBypassRoute) return <>{children}</>;

  if (!ready || !signedIn) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50 text-sm text-slate-400 dark:bg-slate-950 dark:text-slate-500">
        Loading…
      </div>
    );
  }

  function handleSignOut() {
    signOut();
    router.replace("/signin");
  }

  return (
    <div className="flex h-screen print:block print:h-auto">
      <div className="print:hidden">
        <Nav />
      </div>
      <div className="flex flex-1 flex-col overflow-hidden print:block print:overflow-visible">
        <header className="flex flex-none items-center gap-4 border-b border-slate-200 px-6 py-2.5 dark:border-slate-800 print:hidden">
          <GlobalSearch />
          <div className="ml-auto flex items-center gap-3">
            <Link
              href="/upload"
              className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition-all duration-200 hover:bg-brand-700 active:scale-95"
            >
              <ScreenIcon name="upload" className="h-4 w-4 flex-none" />
              Upload
            </Link>
            <ThemeToggle />
            <button
              onClick={handleSignOut}
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            >
              Sign out
            </button>
          </div>
        </header>
        <main key={pathname} className="route-fade flex-1 overflow-y-auto p-8 print:overflow-visible print:p-0">
          {children}
        </main>
      </div>
      <AskAria />
      <Toaster />
    </div>
  );
}
