"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getSession, signOut } from "@/lib/auth";
import { Nav } from "@/components/Nav";
import { ThemeToggle } from "@/components/ThemeToggle";

/* Hides the app (nav + header) until signed in. The Sign In page renders
   full-screen with no chrome; every other route needs a session or gets bounced. */
export function AuthGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    const session = getSession();
    setSignedIn(Boolean(session));
    setReady(true);
    if (!session && pathname !== "/signin") {
      router.replace("/signin");
    }
  }, [pathname, router]);

  if (pathname === "/signin") return <>{children}</>;

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
        <header className="flex flex-none items-center justify-end gap-3 border-b border-slate-200 px-6 py-3 dark:border-slate-800 print:hidden">
          <ThemeToggle />
          <button
            onClick={handleSignOut}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            Sign out
          </button>
        </header>
        <main className="flex-1 overflow-y-auto p-8 print:overflow-visible print:p-0">{children}</main>
      </div>
    </div>
  );
}
