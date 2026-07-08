"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getSession } from "@/lib/auth";
import { Nav } from "@/components/Nav";

/* Hides the app (and the nav sidebar) until signed in. The Sign In page renders
   full-screen with no sidebar; every other route needs a session or gets bounced. */
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
      <div className="flex h-screen items-center justify-center text-sm text-slate-400">
        Loading…
      </div>
    );
  }

  return (
    <div className="flex h-screen">
      <Nav />
      <main className="flex-1 overflow-y-auto p-8">{children}</main>
    </div>
  );
}
