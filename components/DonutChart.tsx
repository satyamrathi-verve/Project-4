"use client";

import { useEffect, useState } from "react";

/*
  A lightweight animated SVG donut. Segments are drawn with stroke-dasharray on
  circles (rotated -90° so 12 o'clock is the start) and grow in on mount.
  Colours come in as text-* utility classes (stroke uses currentColor), so both
  themes work automatically.
*/

export interface DonutSegment {
  label: string;
  value: number;
  colorClass: string; // e.g. "text-red-500"
}

const R = 44;
const C = 2 * Math.PI * R;

export function DonutChart({
  segments,
  centerValue,
  centerLabel,
  size = 168,
}: {
  segments: DonutSegment[];
  centerValue: string;
  centerLabel: string;
  size?: number;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 60);
    return () => clearTimeout(t);
  }, []);

  const total = Math.max(
    1,
    segments.reduce((s, x) => s + x.value, 0)
  );

  let acc = 0;
  return (
    <svg viewBox="0 0 120 120" style={{ width: size, height: size }} role="img" aria-label={`${centerLabel}: ${centerValue}`}>
      {/* track */}
      <circle cx="60" cy="60" r={R} fill="none" strokeWidth="14" className="stroke-slate-100 dark:stroke-slate-800" />
      {segments.map((seg) => {
        const frac = seg.value / total;
        const start = acc;
        acc += frac;
        if (seg.value <= 0) return null;
        // tiny 0.5% gap between segments so they read as separate
        const len = Math.max(0, frac - 0.005) * C;
        return (
          <circle
            key={seg.label}
            cx="60"
            cy="60"
            r={R}
            fill="none"
            strokeWidth="14"
            stroke="currentColor"
            className={seg.colorClass}
            strokeDasharray={`${mounted ? len : 0} ${C}`}
            strokeDashoffset={-start * C}
            transform="rotate(-90 60 60)"
            style={{ transition: "stroke-dasharray 0.9s cubic-bezier(0.22, 1, 0.36, 1)" }}
          >
            <title>{`${seg.label}: ${seg.value}`}</title>
          </circle>
        );
      })}
      <text x="60" y="58" textAnchor="middle" fontSize="20" fontWeight="800" className="fill-slate-900 dark:fill-white">
        {centerValue}
      </text>
      <text x="60" y="72" textAnchor="middle" fontSize="8" className="fill-slate-400 dark:fill-slate-500">
        {centerLabel}
      </text>
    </svg>
  );
}
