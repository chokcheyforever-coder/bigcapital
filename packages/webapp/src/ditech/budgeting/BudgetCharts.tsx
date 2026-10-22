// @ts-nocheck
// 103 DiTech: small dependency-free charts for the budget dashboard and forecasts (Phase 6).
import { Classes } from '@blueprintjs/core';

export interface ChartPoint {
  label: string;
  /** Bars (budget). */
  bar: number | null;
  /** Solid line (actual). */
  line: number | null;
  /** Dashed line (forecast), drawn where there is no actual. */
  dashed?: number | null;
}

const COLORS = { bar: '#c5d5ea', line: '#2965cc', dashed: '#d9822b', axis: '#ccc' };

/**
 * Budget as bars, actual as a solid line, forecast as a dashed line, on one
 * scale that always includes zero. Purely presentational: the numbers come
 * from the reports.
 */
export function BudgetChart({ points, height = 180, testId }: { points: ChartPoint[]; height?: number; testId?: string }) {
  const width = 640;
  // Left padding holds the value scale.
  const pad = { top: 10, right: 8, bottom: 22, left: 52 };
  const values = points.flatMap((p) => [p.bar, p.line, p.dashed]).filter((v): v is number => v !== null && v !== undefined);
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const step = innerW / Math.max(points.length, 1);
  const y = (v: number) => pad.top + ((max - v) / span) * innerH;
  const x = (i: number) => pad.left + step * i + step / 2;
  const path = (key: 'line' | 'dashed') => {
    let d = '';
    points.forEach((p, i) => {
      const v = p[key];
      if (v === null || v === undefined) return;
      d += `${d ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    });
    return d;
  };
  const barW = Math.max(step * 0.55, 2);

  // The test id sits on a div: SVG attributes are case-sensitive and the e2e suite looks for data-testId.
  return (
    <div data-testid={testId}>
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label="Budget and actual by month" style={{ maxWidth: width }}>
      {[max, 0, min]
        .filter((v, i, all) => all.indexOf(v) === i)
        .map((v) => (
          <g key={`s${v}`}>
            {v !== 0 && <line x1={pad.left} x2={width - pad.right} y1={y(v)} y2={y(v)} stroke={COLORS.axis} strokeDasharray="2 4" opacity={0.6} />}
            <text x={pad.left - 6} y={y(v) + 3} textAnchor="end" fontSize={10} fill="#738091">
              {Math.round(v).toLocaleString()}
            </text>
          </g>
        ))}
      <line x1={pad.left} x2={width - pad.right} y1={y(0)} y2={y(0)} stroke={COLORS.axis} />
      {points.map((p, i) =>
        p.bar === null || p.bar === undefined ? null : (
          <rect key={`b${i}`} x={x(i) - barW / 2} width={barW} y={Math.min(y(p.bar), y(0))} height={Math.abs(y(p.bar) - y(0))} fill={COLORS.bar}>
            <title>{`${p.label}: budget ${p.bar.toLocaleString()}`}</title>
          </rect>
        ),
      )}
      <path d={path('dashed')} fill="none" stroke={COLORS.dashed} strokeWidth={2} strokeDasharray="5 4" />
      <path d={path('line')} fill="none" stroke={COLORS.line} strokeWidth={2} />
      {points.map((p, i) =>
        p.line === null || p.line === undefined ? null : (
          <circle key={`l${i}`} cx={x(i)} cy={y(p.line)} r={2.5} fill={COLORS.line}>
            <title>{`${p.label}: actual ${p.line.toLocaleString()}`}</title>
          </circle>
        ),
      )}
      {points.map((p, i) => (
        <text key={`t${i}`} x={x(i)} y={height - 6} textAnchor="middle" fontSize={10} fill="#738091">
          {p.label}
        </text>
      ))}
    </svg>
    </div>
  );
}

export function ChartLegend({ dashed = false }: { dashed?: boolean }) {
  const item = (color: string, text: string, style = {}) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginRight: 12 }}>
      <span style={{ display: 'inline-block', width: 14, height: 8, background: color, ...style }} />
      {text}
    </span>
  );
  return (
    <div className={Classes.TEXT_MUTED} style={{ fontSize: 12 }}>
      {item(COLORS.bar, 'Budget')}
      {item(COLORS.line, 'Actual', { height: 2 })}
      {dashed && item(COLORS.dashed, 'Forecast', { height: 2 })}
    </div>
  );
}
