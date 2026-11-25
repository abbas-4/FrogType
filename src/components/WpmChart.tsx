import { Area, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Sample } from '../types';

const tick = { fill: 'var(--ft-sub)', fontSize: 13 };
const axisLabel = { fill: 'var(--ft-sub)', fontSize: 11, style: { textAnchor: 'middle' } } as const;
const tooltipStyle = { background: 'color-mix(in srgb, var(--ft-bg) 55%, black)', border: 'none', borderRadius: 4, padding: '6px 10px', fontSize: 12, color: 'var(--ft-text)' };

// Monkeytype-style "x" marker for errors; seconds without errors get no mark.
function ErrorMark({ cx, cy, value }: { cx?: number; cy?: number; value?: number | null }) {
  if (cx == null || cy == null || value == null) return <g />;
  return <path d={`M${cx - 3} ${cy - 3}L${cx + 3} ${cy + 3}M${cx + 3} ${cy - 3}L${cx - 3} ${cy + 3}`} stroke="var(--ft-error)" strokeWidth={2} strokeLinecap="round" />;
}

export default function WpmChart({ samples }: { samples: Sample[] }) {
  if (samples.length < 2) return <p className="py-8 text-center text-sm text-sub">Not enough data for a chart.</p>;
  const data = samples.map((s) => ({ ...s, errorsDot: s.errors > 0 ? s.errors : null }));
  return (
    <div className="h-56 w-full sm:h-64 lg:h-72 2xl:h-80" role="img" aria-label="Words per minute over time">
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--ft-surface-2)" strokeOpacity={0.6} />
          <XAxis dataKey="t" tick={tick} axisLine={false} tickLine={false} />
          <YAxis
            yAxisId="wpm"
            domain={[0, 'auto']}
            allowDecimals={false}
            width={48}
            tick={tick}
            axisLine={false}
            tickLine={false}
            label={{ ...axisLabel, value: 'Words per Minute', angle: -90, position: 'insideLeft' }}
          />
          <YAxis
            yAxisId="err"
            orientation="right"
            domain={[0, 'dataMax + 2']}
            allowDecimals={false}
            width={36}
            tick={tick}
            axisLine={false}
            tickLine={false}
            label={{ ...axisLabel, value: 'Errors', angle: 90, position: 'insideRight' }}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            itemStyle={{ padding: 0 }}
            cursor={{ stroke: 'var(--ft-sub)', strokeOpacity: 0.4 }}
            labelFormatter={(t) => `${t}s`}
            formatter={(v) => (typeof v === 'number' ? Math.round(v) : v)}
          />
          <Legend
            align="right"
            verticalAlign="bottom"
            iconSize={10}
            wrapperStyle={{ fontSize: 13 }}
            formatter={(value) => <span style={{ color: 'var(--ft-sub)' }}>{value}</span>}
          />
          <Area
            yAxisId="wpm"
            type="monotone"
            dataKey="raw"
            name="raw"
            stroke="var(--ft-sub)"
            strokeWidth={1.5}
            fill="var(--ft-sub)"
            fillOpacity={0.08}
            dot={{ r: 1.5, fill: 'var(--ft-sub)', strokeWidth: 0 }}
            activeDot={{ r: 3 }}
            isAnimationActive={false}
          />
          <Line
            yAxisId="wpm"
            type="monotone"
            dataKey="wpm"
            name="wpm"
            stroke="var(--ft-brand)"
            strokeWidth={2}
            dot={{ r: 1.5, fill: 'var(--ft-brand)', strokeWidth: 0 }}
            activeDot={{ r: 3 }}
            isAnimationActive={false}
          />
          {/* An invisible line rather than a Scatter, so the tooltip doesn't list the scatter's x value. */}
          <Line yAxisId="err" dataKey="errorsDot" name="errors" stroke="var(--ft-error)" strokeWidth={0} dot={ErrorMark} activeDot={false} legendType="cross" isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
