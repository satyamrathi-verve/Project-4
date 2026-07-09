/*
  Front-end-only auth for the demo. No backend, no users table — just a small
  built-in list of logins checked in the browser. A match sets a flag in
  localStorage so a refresh stays signed in.
*/

export const DEMO_LOGINS = [
  { username: "admin", password: "admin123" },
  { username: "finance", password: "verve123" },
];

const SESSION_KEY = "ar-manager-session";

export function checkLogin(username: string, password: string): boolean {
  const u = username.trim();
  const p = password.trim();
  return DEMO_LOGINS.some((l) => l.username === u && l.password === p);
}

export function signIn(username: string) {
  localStorage.setItem(SESSION_KEY, username);
}

export function signOut() {
  localStorage.removeItem(SESSION_KEY);
}

export function getSession(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(SESSION_KEY);
}
