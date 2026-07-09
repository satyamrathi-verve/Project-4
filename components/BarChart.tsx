"use client";

import { useState } from "react";

/*
  A small hand-rolled SVG bar + line chart — no charting library is installed
  (see package.json), so this stays dependency-free. Each bar is stacked into
  an "already overdue" segment (red) and an "on-time expected" segment (brand
  blue) so collection risk reads at a glance; the line shows the running
  cumulative total on the same scale. Hover a column for exact figures.
*/
export interface BarChartDatum {
  key: string;
  label: string;
  overdueValue: number;
  overdueCount: number;
  onTimeValue: number;
  onTimeCount: number;
  cumulative: number;
}

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

export function BarChart({ data }: { data: BarChartDatum[] }) {
  const [hovered, setHovered] = useState<number | null>(null);
  if (data.length === 0) return null;

  const width = 900;
  const height = 260;
  const padLeft = 8;
  const padRight = 8;
  const padTop = 16;
  const padBottom = 34;
  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;
  const baseline = padTop + chartH;
  const maxVal = Math.max(...data.map((d) => d.cumulative), 1);
  const barSlot = chartW / data.length;
  const barWidth = Math.min(barSlot * 0.55, 42);

  const points = data.map((d, i) => ({
    x: padLeft + barSlot * i + barSlot / 2,
    y: baseline - (d.cumulative / maxVal) * chartH,
  }));
  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");

  const bars = data.map((d, i) => {
    const overdueH = maxVal ? (d.overdueValue / maxVal) * chartH : 0;
    const onTimeH = maxVal ? (d.onTimeValue / maxVal) * chartH : 0;
    const overdueY = baseline - overdueH;
    const onTimeY = overdueY - onTimeH;
    const x = padLeft + barSlot * i + (barSlot - barWidth) / 2;
    return { x, overdueY, overdueH, onTimeY, onTimeH, topY: onTimeY };
  });

  const active = hovered !== null ? data[hovered] : null;
  const activeBar = hovered !== null ? bars[hovered] : null;
  const activePoint = hovered !== null ? points[hovered] : null;
  const anchorY = activeBar && activePoint ? Math.min(activeBar.topY, activePoint.y) : 0;
  const anchorX = hovered !== null ? padLeft + barSlot * hovered + barSlot / 2 : 0;
  // Near the first/last couple of columns, centering the tooltip on the point
  // would push it past the card's edge — anchor to the near side instead.
  const align = hovered === null ? "center" : hovered <= 1 ? "start" : hovered >= data.length - 2 ? "end" : "center";
  const translateX = align === "start" ? "0%" : align === "end" ? "-100%" : "-50%";

  return (
    <div className="overflow-x-auto overflow-y-visible">
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-500 dark:text-slate-400">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-brand dark:bg-brand-400" /> On-time expected
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-red-500" /> Already overdue
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-accent" /> Cumulative
        </span>
      </div>

      <div className="relative pt-10" style={{ minWidth: data.length * 46 }}>
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full overflow-visible">
          <line x1={padLeft} y1={baseline} x2={width - padRight} y2={baseline} strokeWidth={1} className="stroke-slate-200 dark:stroke-slate-700" />

          {data.map((d, i) => {
            const b = bars[i];
            const x = padLeft + barSlot * i;
            return (
              <g key={d.key}>
                {/* invisible full-height hit area so hovering anywhere in the column works, not just the thin bar */}
                <rect
                  x={x}
                  y={padTop}
                  width={barSlot}
                  height={chartH}
                  fill="transparent"
                  className="cursor-pointer"
                  onMouseEnter={() => setHovered(i)}
                  onMouseLeave={() => setHovered((h) => (h === i ? null : h))}
                />
                {d.overdueValue > 0 && (
                  <rect
                    x={b.x}
                    y={b.overdueY}
                    width={barWidth}
                    height={Math.max(b.overdueH, 1)}
                    rx={2}
                    className="pointer-events-none fill-red-500"
                  />
                )}
                {d.onTimeValue > 0 && (
                  <rect
                    x={b.x}
                    y={b.onTimeY}
                    width={barWidth}
                    height={Math.max(b.onTimeH, 1)}
                    rx={2}
                    className="pointer-events-none fill-brand dark:fill-brand-400"
                  />
                )}
                {d.overdueValue === 0 && d.onTimeValue === 0 && (
                  <rect x={b.x} y={baseline - 1} width={barWidth} height={1} className="pointer-events-none fill-slate-200 dark:fill-slate-700" />
                )}
                {hovered === i && (
                  <rect
                    x={x}
                    y={padTop}
                    width={barSlot}
                    height={chartH}
                    className="pointer-events-none fill-slate-900/[0.03] dark:fill-white/[0.04]"
                  />
                )}
                <text
                  x={b.x + barWidth / 2}
                  y={padTop + chartH + 16}
                  textAnchor="middle"
                  className="pointer-events-none fill-slate-400 text-[9px] dark:fill-slate-500"
                >
                  {d.label}
                </text>
              </g>
            );
          })}

          <path d={linePath} fill="none" strokeWidth={2} className="pointer-events-none stroke-accent" />
          {points.map((p, i) => (
            <circle
              key={data[i].key}
              cx={p.x}
              cy={p.y}
              r={hovered === i ? 4.5 : 3}
              className="pointer-events-none fill-accent transition-all"
            />
          ))}
        </svg>

        {active && (
          <div
            className="pointer-events-none absolute z-10 w-52 rounded-lg border border-slate-200 bg-white p-3 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-800"
            style={{
              left: `${(anchorX / width) * 100}%`,
              top: `${(anchorY / height) * 100}%`,
              transform: `translate(${translateX}, calc(-100% - 10px))`,
            }}
          >
            <p className="font-semibold text-slate-700 dark:text-slate-200">{active.label}</p>
            <p className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">
              {active.overdueCount + active.onTimeCount} invoice{active.overdueCount + active.onTimeCount === 1 ? "" : "s"}
            </p>
            <div className="mt-2 space-y-1">
              {active.overdueValue > 0 && (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-red-500">Overdue ({active.overdueCount})</span>
                  <span className="font-medium text-red-500">{inr.format(active.overdueValue)}</span>
                </div>
              )}
              {active.onTimeValue > 0 && (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-slate-500 dark:text-slate-400">On-time ({active.onTimeCount})</span>
                  <span className="font-medium text-slate-700 dark:text-slate-300">{inr.format(active.onTimeValue)}</span>
                </div>
              )}
              {active.overdueValue === 0 && active.onTimeValue === 0 && (
                <p className="text-slate-400 dark:text-slate-500">Nothing expected this period.</p>
              )}
              <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-1 dark:border-slate-700">
                <span className="text-slate-500 dark:text-slate-400">Cumulative</span>
                <span className="font-semibold text-accent">{inr.format(active.cumulative)}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
