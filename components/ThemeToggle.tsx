"use client";

import { useEffect, useState } from "react";

/*
  The light/dark switch — an icon-only button that lives in the top-right bar.
  The choice is saved in localStorage("theme") and applied as a `dark` class on
  <html>; a tiny script in app/layout.tsx re-applies it before the page paints so
  a refresh never flashes the wrong theme.
*/
export function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  }

  return (
    <button
      type="button"
      onClick={toggle}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      className="group flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition-colors hover:bg-slate-100 hover:text-brand active:scale-90 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-brand-300"
    >
      <span
        key={dark ? "moon" : "sun"}
        className="flex items-center justify-center transition-transform duration-300 group-hover:rotate-45 animate-[fade-in_0.3s_ease-out]"
      >
        {dark ? (
          <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </svg>
        ) : (
          <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
          </svg>
        )}
      </span>
    </button>
  );
}
