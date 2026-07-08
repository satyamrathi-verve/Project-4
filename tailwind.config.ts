import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        /* Verve Advisory brand palette (from verveadvisory.in) */
        brand: {
          DEFAULT: "#23408b",
          dark: "#102458",
          50: "#eef2fa",
          100: "#dce5f5",
          200: "#b9cbeb",
          300: "#8faade",
          400: "#5f83cc",
          500: "#3a5fb0",
          600: "#23408b",
          700: "#1d3573",
          800: "#16295a",
          900: "#102458",
          950: "#0a1019",
        },
        accent: {
          DEFAULT: "#fe7a15",
        },
      },
      fontFamily: {
        sans: ["var(--font-montserrat)", "Montserrat", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
