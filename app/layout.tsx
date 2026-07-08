import type { Metadata } from "next";
import { Montserrat } from "next/font/google";
import "./globals.css";
import { AuthGate } from "@/components/AuthGate";

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
        <AuthGate>{children}</AuthGate>
      </body>
    </html>
  );
}
