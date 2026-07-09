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
      keyframes: {
        "fade-in-up": {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "grow-x": {
          "0%": { transform: "scaleX(0)" },
          "100%": { transform: "scaleX(1)" },
        },
        shake: {
          "0%, 100%": { transform: "translateX(0)" },
          "20%, 60%": { transform: "translateX(-6px)" },
          "40%, 80%": { transform: "translateX(6px)" },
        },
      },
      animation: {
        "fade-in-up": "fade-in-up 0.5s ease-out both",
        "fade-in": "fade-in 0.4s ease-out both",
        "grow-x": "grow-x 0.9s cubic-bezier(0.22, 1, 0.36, 1) both",
        shake: "shake 0.4s ease-in-out",
      },
    },
  },
  plugins: [],
};

export default config;
