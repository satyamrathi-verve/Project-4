"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { isSignedIn } from "@/lib/auth";
import { Nav } from "@/components/Nav";

/*
  Gates every page except /signin behind the front-end login. Shows nothing
  while checking localStorage (avoids a flash of protected content), then
  either the standalone Sign In page or the Nav + page shell.
*/
export function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    setAuthed(isSignedIn());
    setReady(true);
  }, [pathname]);

  useEffect(() => {
    if (ready && !authed && pathname !== "/signin") {
      router.replace("/signin");
    }
  }, [ready, authed, pathname, router]);

  if (pathname === "/signin") {
    return <>{children}</>;
  }

  if (!ready || !authed) {
    return null;
  }

  return (
    <div className="flex h-screen">
      <Nav />
      <main className="flex-1 overflow-y-auto p-8">{children}</main>
    </div>
  );
}
