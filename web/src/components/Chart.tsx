import type { ChatEvent } from "../types";

type ChartEvent = Extract<ChatEvent, { type: "agent.chart" }>;

// Single-series trend sparkline (stat-tile pattern, not a full dashboard chart):
// line color is a status token (good/warn) since it encodes gain/loss, not
// series identity, so no legend is needed. The endpoint gets a direct value
// label — the only number worth labeling on a 6-point line — and every value
// a screen reader needs (start, end, direction) is also in the aria-label and
// the surrounding chat text, so there's no hover-only data here.
export function Chart({ event }: { event: ChartEvent }) {
  const { title, unit, points, changePct } = event;
  const positive = changePct >= 0;

  const width = 280;
  const height = 64;
  const padX = 6;
  const padY = 10;

  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = points.length > 1 ? (width - padX * 2) / (points.length - 1) : 0;

  const coords = points.map((p, i) => ({
    x: padX + i * stepX,
    y: padY + (1 - (p.value - min) / span) * (height - padY * 2),
  }));

  const linePath = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  const last = coords[coords.length - 1];
  const colorVar = positive ? "var(--good)" : "var(--warn)";

  function formatValue(v: number): string {
    return unit === "inr" ? `₹${Math.round(v).toLocaleString("en-IN")}` : `${v.toFixed(1)}%`;
  }

  const startLabel = points[0]?.label ?? "";
  const endLabel = points[points.length - 1]?.label ?? "";
  const trendSummary = `${formatValue(values[0])} to ${formatValue(values[values.length - 1])}, ${
    positive ? "up" : "down"
  } ${Math.abs(changePct).toFixed(2)}% over the shown period`;

  return (
    <div className="card chart-card">
      <div className="chart-head">
        <span className="chart-title">{title}</span>
        <span className={`chart-badge ${positive ? "good" : "warn"}`}>
          {positive ? "+" : ""}
          {changePct.toFixed(2)}%
        </span>
      </div>
      <svg className="chart-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={trendSummary}>
        <path d={linePath} fill="none" stroke={colorVar} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={last.x} cy={last.y} r={4} fill={colorVar} stroke="var(--surface)" strokeWidth={2} />
      </svg>
      <div className="chart-footer">
        <span>{startLabel}</span>
        <span className="chart-end">
          {formatValue(values[values.length - 1])} <span className="chart-axis-label">({endLabel})</span>
        </span>
      </div>
    </div>
  );
}
