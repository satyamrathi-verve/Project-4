/*
  A small hand-rolled SVG bar + line chart — no charting library is installed
  (see package.json), so this stays dependency-free. Bars show the per-period
  value; the line shows the running cumulative total on the same scale. Reuse
  this for any future screen that needs a lightweight chart (e.g. Dashboard).
*/
export interface BarChartDatum {
  key: string;
  label: string;
  value: number;
  cumulative: number;
}

export function BarChart({ data }: { data: BarChartDatum[] }) {
  if (data.length === 0) return null;

  const width = 900;
  const height = 260;
  const padLeft = 8;
  const padRight = 8;
  const padTop = 16;
  const padBottom = 34;
  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;
  const maxVal = Math.max(...data.map((d) => d.cumulative), 1);
  const barSlot = chartW / data.length;
  const barWidth = Math.min(barSlot * 0.55, 42);

  const points = data.map((d, i) => ({
    x: padLeft + barSlot * i + barSlot / 2,
    y: padTop + chartH - (d.cumulative / maxVal) * chartH,
  }));
  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-3 flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-brand dark:bg-brand-400" /> Expected inflow
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-accent" /> Cumulative
        </span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ minWidth: data.length * 46 }}>
        <line
          x1={padLeft}
          y1={padTop + chartH}
          x2={width - padRight}
          y2={padTop + chartH}
          strokeWidth={1}
          className="stroke-slate-200 dark:stroke-slate-700"
        />
        {data.map((d, i) => {
          const x = padLeft + barSlot * i + (barSlot - barWidth) / 2;
          const barH = maxVal ? (d.value / maxVal) * chartH : 0;
          const y = padTop + chartH - barH;
          return (
            <g key={d.key}>
              <rect x={x} y={y} width={barWidth} height={Math.max(barH, 1)} rx={3} className="fill-brand dark:fill-brand-400" />
              <text
                x={x + barWidth / 2}
                y={padTop + chartH + 16}
                textAnchor="middle"
                className="fill-slate-400 text-[9px] dark:fill-slate-500"
              >
                {d.label}
              </text>
            </g>
          );
        })}
        <path d={linePath} fill="none" strokeWidth={2} className="stroke-accent" />
        {points.map((p, i) => (
          <circle key={data[i].key} cx={p.x} cy={p.y} r={3} className="fill-accent" />
        ))}
      </svg>
    </div>
  );
}
