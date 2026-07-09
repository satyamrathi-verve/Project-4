"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { inr, inrCompact } from "@/lib/format";

/*
  Reusable multi-series SVG line chart for the AR reports.
  - Colours are given per series as a { light, dark } pair (both palettes are
    CVD-validated); the chart listens to the <html> `dark` class so it recolours
    live when the theme toggle flips.
  - Interactive by default: hover shows a crosshair + tooltip with every series'
    value at that point; markers enlarge on the hovered index.
  - Legend renders whenever there are 2+ series (identity is never colour-alone —
    the legend names each series).
  - Open styling: recessive gridlines, muted axis text, no surrounding box.
*/

export interface LineSeries {
  name: string;
  values: number[];
  color: { light: string; dark: string };
  /** Optional dashed rendering (e.g. cumulative overlays). */
  dashed?: boolean;
}

function useIsDark(): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const el = document.documentElement;
    const update = () => setDark(el.classList.contains("dark"));
    update();
    const obs = new MutationObserver(update);
    obs.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nice * exp;
}

const W = 640;
const H = 240;
const PAD = { top: 14, right: 14, bottom: 26, left: 52 };

export function LineChart({
  labels,
  series,
  height = 240,
  valueFormat = (n: number) => inr.format(n),
}: {
  labels: string[];
  series: LineSeries[];
  height?: number;
  valueFormat?: (n: number) => string;
}) {
  const isDark = useIsDark();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const max = useMemo(() => niceMax(Math.max(1, ...series.flatMap((s) => s.values))), [series]);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);

  const n = labels.length;
  const x = (i: number) => PAD.left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;

  const pathFor = (vals: number[]) => vals.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");

  function onMove(e: React.MouseEvent) {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect || n === 0) return;
    const relX = ((e.clientX - rect.left) / rect.width) * W;
    const idx = Math.round(((relX - PAD.left) / innerW) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, idx)));
  }

  const surfaceStroke = isDark ? "#0a1019" : "#ffffff";
  const everyOther = n > 8;

  // Tooltip placement: percentage of container width, flipped near the right edge.
  const tipLeftPct = hover === null ? 0 : (x(hover) / W) * 100;
  const tipFlip = tipLeftPct > 62;

  return (
    <div>
      {series.length >= 2 && (
        <div className="mb-2 flex flex-wrap items-center gap-4">
          {series.map((s) => (
            <span key={s.name} className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
              <span
                className="inline-block h-[3px] w-4 rounded-full"
                style={{ background: isDark ? s.color.dark : s.color.light }}
              />
              {s.name}
            </span>
          ))}
        </div>
      )}

      <div ref={wrapRef} className="relative" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", maxHeight: height }} role="img">
          {/* gridlines + y labels */}
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y(t)}
                y2={y(t)}
                className="stroke-slate-200 dark:stroke-slate-800"
                strokeWidth={1}
              />
              <text x={PAD.left - 8} y={y(t) + 3.5} textAnchor="end" fontSize={10} className="fill-slate-400 dark:fill-slate-500">
                {inrCompact(t)}
              </text>
            </g>
          ))}

          {/* x labels */}
          {labels.map((l, i) =>
            everyOther && i % 2 === 1 ? null : (
              <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize={10} className="fill-slate-400 dark:fill-slate-500">
                {l}
              </text>
            )
          )}

          {/* crosshair */}
          {hover !== null && (
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={PAD.top}
              y2={PAD.top + innerH}
              className="stroke-slate-300 dark:stroke-slate-700"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          )}

          {/* series lines */}
          {series.map((s) => (
            <path
              key={s.name}
              d={pathFor(s.values)}
              fill="none"
              stroke={isDark ? s.color.dark : s.color.light}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={s.dashed ? "6 4" : undefined}
            />
          ))}

          {/* hover markers (2px surface ring so overlapping points stay separable) */}
          {hover !== null &&
            series.map((s) => (
              <circle
                key={s.name}
                cx={x(hover)}
                cy={y(s.values[hover] ?? 0)}
                r={4.5}
                fill={isDark ? s.color.dark : s.color.light}
                stroke={surfaceStroke}
                strokeWidth={2}
              />
            ))}
        </svg>

        {/* tooltip */}
        {hover !== null && (
          <div
            className="pointer-events-none absolute top-1 z-10 min-w-[150px] border border-slate-200 bg-white px-3 py-2 text-xs shadow-md dark:border-slate-700 dark:bg-slate-900"
            style={tipFlip ? { right: `${100 - tipLeftPct + 2}%` } : { left: `${tipLeftPct + 2}%` }}
          >
            <p className="mb-1 font-semibold text-slate-600 dark:text-slate-300">{labels[hover]}</p>
            {series.map((s) => (
              <p key={s.name} className="flex items-center justify-between gap-4 text-slate-500 dark:text-slate-400">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: isDark ? s.color.dark : s.color.light }} />
                  {s.name}
                </span>
                <span className="font-semibold tabular-nums text-slate-700 dark:text-slate-200">{valueFormat(s.values[hover] ?? 0)}</span>
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* The CVD-validated chart palette (light + dark pairs). Assign in this fixed order. */
export const CHART_COLORS = {
  blue: { light: "#3a5fb0", dark: "#5f83cc" },
  orange: { light: "#ea6a0a", dark: "#e8630a" },
  green: { light: "#0f8a5f", dark: "#0ea371" },
  purple: { light: "#7c3aed", dark: "#8b5cf6" },
} as const;
