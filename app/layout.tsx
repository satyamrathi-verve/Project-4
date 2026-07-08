import type { Metadata } from "next";
import { Montserrat } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { ThemeToggle } from "@/components/ThemeToggle";

const montserrat = Montserrat({ subsets: ["latin"], variable: "--font-montserrat" });

export const metadata: Metadata = {
  title: "AR Manager — Verve",
  description: "Accounts Receivable manager",
};

/* Applies the saved theme before first paint so there's no light/dark flash. */
const themeInit = `try{var t=localStorage.getItem("theme");if(t==="dark"||(!t&&window.matchMedia("(prefers-color-scheme: dark)").matches)){document.documentElement.classList.add("dark")}}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className={`${montserrat.variable} font-sans`}>
        <div className="flex h-screen">
          <Nav />
          <div className="flex flex-1 flex-col overflow-hidden">
            <header className="flex flex-none items-center justify-end border-b border-slate-200 px-6 py-3 dark:border-slate-800">
              <ThemeToggle />
            </header>
            <main className="flex-1 overflow-y-auto p-8">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
