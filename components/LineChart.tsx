"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
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
const PAD = { top: 14, right: 60, bottom: 26, left: 52 };

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
  const gid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const wrapRef = useRef<HTMLDivElement>(null);
  const pathsRef = useRef<(SVGPathElement | null)[]>([]);
  const [hover, setHover] = useState<number | null>(null);
  const [inView, setInView] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  function toggleSeries(name: string) {
    setHidden((h) => {
      const visibleCount = series.filter((s) => !h.has(s.name)).length;
      const next = new Set(h);
      if (next.has(name)) next.delete(name);
      else if (visibleCount > 1) next.add(name); // never hide the last visible series
      return next;
    });
  }

  // Draw-on-view: once the chart scrolls into the viewport, each solid line
  // "draws" itself left-to-right (stroke-dash trick); dashed overlays fade in
  // instead (the dash pattern IS their data styling, so we can't dash-animate).
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setInView(true);
            obs.disconnect();
          }
        }
      },
      { threshold: 0.25 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!inView) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    pathsRef.current.forEach((p, i) => {
      const s = series[i];
      if (!p || !s || hidden.has(s.name)) return;
      if (s.dashed) {
        p.style.transition = "none";
        p.style.opacity = "0";
        void p.getBoundingClientRect();
        p.style.transition = reduce ? "none" : `opacity 0.6s ease-out ${0.45 + i * 0.18}s`;
        p.style.opacity = "1";
      } else {
        const len = p.getTotalLength();
        p.style.transition = "none";
        p.style.opacity = "1";
        p.style.strokeDasharray = `${len}`;
        p.style.strokeDashoffset = reduce ? "0" : `${len}`;
        void p.getBoundingClientRect();
        p.style.transition = reduce ? "none" : `stroke-dashoffset 1.2s cubic-bezier(0.22, 1, 0.36, 1) ${i * 0.18}s`;
        p.style.strokeDashoffset = "0";
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView, series, isDark, hidden]);

  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const max = useMemo(
    () => niceMax(Math.max(1, ...series.filter((s) => !hidden.has(s.name)).flatMap((s) => s.values))),
    [series, hidden]
  );
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
            <button
              key={s.name}
              type="button"
              onClick={() => toggleSeries(s.name)}
              title={hidden.has(s.name) ? "Click to show" : "Click to hide"}
              className={`flex items-center gap-1.5 text-xs font-medium text-slate-500 transition-opacity hover:opacity-80 dark:text-slate-400 ${
                hidden.has(s.name) ? "opacity-40 line-through" : ""
              }`}
            >
              <span
                className="inline-block h-[3px] w-4 rounded-full"
                style={{ background: isDark ? s.color.dark : s.color.light }}
              />
              {s.name}
            </button>
          ))}
        </div>
      )}

      <div ref={wrapRef} className="relative" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", maxHeight: height }} role="img">
          <defs>
            {series.map((s, i) => {
              const color = isDark ? s.color.dark : s.color.light;
              return (
                <linearGradient key={s.name} id={`${gid}-${i}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity="0.24" />
                  <stop offset="100%" stopColor={color} stopOpacity="0.02" />
                </linearGradient>
              );
            })}
          </defs>

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

          {/* gradient area fills (drawn under the lines) */}
          {inView &&
            series.map((s, i) => {
              if (hidden.has(s.name) || s.dashed || s.values.length < 2) return null;
              const base = PAD.top + innerH;
              const dAttr = `${pathFor(s.values)} L${x(s.values.length - 1).toFixed(1)},${base} L${x(0).toFixed(1)},${base} Z`;
              return (
                <path
                  key={`area-${s.name}`}
                  d={dAttr}
                  fill={`url(#${gid}-${i})`}
                  stroke="none"
                  style={{ animation: "fade-in-soft 0.9s ease-out 0.25s both" }}
                />
              );
            })}

          {/* series lines */}
          {series.map((s, i) =>
            hidden.has(s.name) ? null : (
              <path
                key={s.name}
                ref={(el) => {
                  pathsRef.current[i] = el;
                }}
                d={pathFor(s.values)}
                fill="none"
                stroke={isDark ? s.color.dark : s.color.light}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={s.dashed ? "6 4" : undefined}
                style={{ opacity: 0 }}
              />
            )
          )}

          {/* hover markers (2px surface ring so overlapping points stay separable) */}
          {hover !== null &&
            series.map((s) =>
              hidden.has(s.name) ? null : (
                <circle
                  key={s.name}
                  cx={x(hover)}
                  cy={y(s.values[hover] ?? 0)}
                  r={4.5}
                  fill={isDark ? s.color.dark : s.color.light}
                  stroke={surfaceStroke}
                  strokeWidth={2}
                />
              )
            )}

          {/* end-point emphasis: dot + value label on each series' last point */}
          {inView &&
            (() => {
              const usedY: number[] = [];
              return series.map((s) => {
                if (hidden.has(s.name) || s.values.length === 0) return null;
                const li = s.values.length - 1;
                const color = isDark ? s.color.dark : s.color.light;
                let labelY = y(s.values[li]) + 3.5;
                for (const prev of usedY) if (Math.abs(prev - labelY) < 11) labelY = prev + 11;
                usedY.push(labelY);
                return (
                  <g key={`end-${s.name}`} style={{ animation: "fade-in-soft 0.5s ease-out 1.1s both" }}>
                    <circle cx={x(li)} cy={y(s.values[li])} r={3.5} fill={color} stroke={surfaceStroke} strokeWidth={1.5} />
                    <text x={x(li) + 7} y={labelY} fontSize={10} fontWeight={700} fill={color}>
                      {inrCompact(s.values[li])}
                    </text>
                  </g>
                );
              });
            })()}
        </svg>

        {/* tooltip */}
        {hover !== null && (
          <div
            className="pointer-events-none absolute top-1 z-10 min-w-[150px] border border-slate-200 bg-white px-3 py-2 text-xs shadow-md dark:border-slate-700 dark:bg-slate-900"
            style={tipFlip ? { right: `${100 - tipLeftPct + 2}%` } : { left: `${tipLeftPct + 2}%` }}
          >
            <p className="mb-1 font-semibold text-slate-600 dark:text-slate-300">{labels[hover]}</p>
            {series.filter((s) => !hidden.has(s.name)).map((s) => (
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
