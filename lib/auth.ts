/*
  Front-end-only session gate for the Sign In screen. No Supabase auth, no
  users table — just a small demo login list checked in the browser, with the
  signed-in flag kept in localStorage so a page refresh stays signed in.
*/

const STORAGE_KEY = "ar-manager-signed-in";

export const DEMO_USERS = [
  { username: "admin", password: "admin123" },
  { username: "finance", password: "finance123" },
];

export function isSignedIn(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(STORAGE_KEY) === "true";
}

export function signIn(username: string, password: string): boolean {
  const match = DEMO_USERS.some(
    (u) => u.username === username && u.password === password
  );
  if (match) {
    window.localStorage.setItem(STORAGE_KEY, "true");
  }
  return match;
}

export function signOut() {
  window.localStorage.removeItem(STORAGE_KEY);
}
