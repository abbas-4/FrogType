import { CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from 'recharts';
import type { Sample } from '../types';

const tooltipStyle = { background: 'var(--ft-surface)', border: '1px solid var(--ft-surface-2)', borderRadius: 8, color: 'var(--ft-text)' };

export default function WpmChart({ samples }: { samples: Sample[] }) {
  if (samples.length < 2) return <p className="py-8 text-center text-sm text-sub">Not enough data for a chart.</p>;
  const data = samples.map((s) => ({ ...s, errorsDot: s.errors > 0 ? s.errors : null }));
  return (
    <div className="h-56 w-full" role="img" aria-label="Words per minute over time">
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid stroke="var(--ft-surface-2)" vertical={false} />
          <XAxis dataKey="t" stroke="var(--ft-sub)" tickLine={false} fontSize={12} />
          <YAxis yAxisId="wpm" stroke="var(--ft-sub)" tickLine={false} fontSize={12} />
          <YAxis yAxisId="err" orientation="right" hide domain={[0, 'dataMax + 2']} />
          <Tooltip contentStyle={tooltipStyle} labelFormatter={(t) => `${t}s`} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line yAxisId="wpm" type="monotone" dataKey="wpm" name="wpm" stroke="var(--ft-brand)" strokeWidth={2} dot={false} isAnimationActive={false} />
          <Line yAxisId="wpm" type="monotone" dataKey="raw" name="raw" stroke="var(--ft-sub)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
          <Scatter yAxisId="err" dataKey="errorsDot" name="errors" fill="var(--ft-error)" shape="cross" isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
