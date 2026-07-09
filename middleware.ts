import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/*
  Route boundary between the internal app and the customer portal.

  The internal login (lib/auth.ts) never touches Supabase Auth — it's a
  client-side-only localStorage flag, invisible to middleware (which runs on
  the server before any browser JS executes). So middleware can't verify an
  internal analyst session; that's still enforced client-side by AuthGate,
  unchanged from before.

  What middleware CAN and does verify server-side: whether there's a real
  Supabase Auth session — which in this app only ever means a logged-in
  customer. That lets us guarantee, at the routing layer (not just by hiding
  a nav link), that a customer session can never render an internal page:
  if a customer's session hits any non-portal route, they're bounced to
  /portal before the page even renders. The actual data boundary (a customer
  only ever seeing their own rows) is enforced by Postgres RLS — this
  middleware is a defense-in-depth routing guard, not the security boundary.
*/

const CUSTOMER_PREFIX = "/portal";
const PUBLIC_PREFIXES = ["/signin"];

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) return response;

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // getUser() (not getSession()) re-validates the JWT against Supabase Auth
  // rather than just trusting the cookie — the recommended check server-side.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isCustomerRoute = pathname.startsWith(CUSTOMER_PREFIX);
  const isPublicRoute = PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));

  // No customer session trying to reach the portal -> back to sign in.
  if (isCustomerRoute && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/signin";
    return NextResponse.redirect(url);
  }

  // A customer session trying to reach anything internal -> bounced to their portal.
  if (!isCustomerRoute && !isPublicRoute && user) {
    const url = request.nextUrl.clone();
    url.pathname = "/portal";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
