import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, PageTitle, Segmented, Stat } from '../components/ui';
import { modeLabel } from '../domain/format';
import { dailyActivity, filterRange, formatDuration, groupProgress, summarize, type Range } from '../domain/stats';
import { useProgress } from '../state/store';

const tooltipStyle = { background: 'var(--ft-surface)', border: '1px solid var(--ft-surface-2)', borderRadius: 8, color: 'var(--ft-text)' };
const axis = { stroke: 'var(--ft-sub)', tickLine: false, fontSize: 12 } as const;

function ChartCard({ title, children, empty }: { title: string; children: React.ReactElement; empty?: boolean }) {
  return (
    <Card>
      <h2 className="mb-3 text-sm font-medium text-sub">{title}</h2>
      {empty ? (
        <p className="py-16 text-center text-sm text-sub">Not enough data in this range.</p>
      ) : (
        <div className="h-52" role="img" aria-label={title}>
          <ResponsiveContainer>{children}</ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

export default function StatsPage() {
  const progress = useProgress();
  const [range, setRange] = useState<Range>('30d');
  const [shown, setShown] = useState(25);
  const now = useMemo(() => new Date(), []);
  const tests = useMemo(() => filterRange(progress.history, range, now), [progress.history, range, now]);
  const s = useMemo(() => summarize(tests, progress.history, now), [tests, progress.history, now]);
  const series = useMemo(() => tests.map((t, i) => ({ n: i + 1, wpm: Math.round(t.wpm), raw: Math.round(t.raw), accuracy: Math.round(t.accuracy * 10) / 10, consistency: Math.round(t.consistency) })), [tests]);
  const days = range === '7d' ? 7 : range === '30d' ? 30 : range === '90d' ? 90 : 90;
  const activity = useMemo(() => dailyActivity(tests, now, days), [tests, now, days]);
  const weekly = useMemo(() => groupProgress(tests, 'week'), [tests]);
  const monthly = useMemo(() => groupProgress(tests, 'month'), [tests]);
  const recent = [...tests].reverse();

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageTitle sub={progress.history.length ? undefined : 'Finish a test to start tracking your progress.'}>Statistics</PageTitle>
        <Segmented<Range>
          label="Date range"
          value={range}
          onChange={setRange}
          options={[
            { value: '7d', label: 'Last 7 days' },
            { value: '30d', label: 'Last 30 days' },
            { value: '90d', label: 'Last 90 days' },
            { value: 'all', label: 'All time' },
          ]}
        />
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <Card><Stat label="avg wpm" value={s.avgWpm.toFixed(1)} /></Card>
        <Card><Stat label="best wpm" value={s.bestWpm.toFixed(1)} /></Card>
        <Card><Stat label="avg accuracy" value={`${s.avgAccuracy.toFixed(1)}%`} /></Card>
        <Card><Stat label="tests" value={s.tests} /></Card>
        <Card><Stat label="typing time" value={formatDuration(s.totalMs)} /></Card>
        <Card><Stat label="words typed" value={s.totalWords} /></Card>
        <Card><Stat label="current streak" value={`${s.currentStreak}d`} /></Card>
        <Card><Stat label="longest streak" value={`${s.longestStreak}d`} /></Card>
        <Card>
          <Stat
            label="improvement"
            value={s.improvement === null ? '—' : `${s.improvement >= 0 ? '+' : ''}${s.improvement.toFixed(1)}`}
            hint="Average wpm of your latest tests vs your earliest tests in this range (needs 10+ tests)"
          />
        </Card>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <ChartCard title="WPM history" empty={series.length < 2}>
          <LineChart data={series} margin={{ left: -16, right: 8 }}>
            <CartesianGrid stroke="var(--ft-surface-2)" vertical={false} />
            <XAxis dataKey="n" {...axis} />
            <YAxis {...axis} />
            <Tooltip contentStyle={tooltipStyle} labelFormatter={(n) => `test ${n}`} />
            <Line dataKey="wpm" stroke="var(--ft-brand)" strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line dataKey="raw" stroke="var(--ft-sub)" strokeWidth={1} dot={false} isAnimationActive={false} />
          </LineChart>
        </ChartCard>
        <ChartCard title="Accuracy history" empty={series.length < 2}>
          <LineChart data={series} margin={{ left: -16, right: 8 }}>
            <CartesianGrid stroke="var(--ft-surface-2)" vertical={false} />
            <XAxis dataKey="n" {...axis} />
            <YAxis {...axis} domain={['dataMin - 2', 100]} />
            <Tooltip contentStyle={tooltipStyle} labelFormatter={(n) => `test ${n}`} />
            <Line dataKey="accuracy" stroke="var(--ft-brand)" strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ChartCard>
        <ChartCard title={`Daily activity (last ${days} days)`} empty={tests.length === 0}>
          <BarChart data={activity} margin={{ left: -16, right: 8 }}>
            <CartesianGrid stroke="var(--ft-surface-2)" vertical={false} />
            <XAxis dataKey="day" {...axis} interval="preserveStartEnd" />
            <YAxis {...axis} allowDecimals={false} />
            <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'var(--ft-surface-2)' }} />
            <Bar dataKey="tests" fill="var(--ft-brand)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ChartCard>
        <ChartCard title="Typing consistency" empty={series.length < 2}>
          <LineChart data={series} margin={{ left: -16, right: 8 }}>
            <CartesianGrid stroke="var(--ft-surface-2)" vertical={false} />
            <XAxis dataKey="n" {...axis} />
            <YAxis {...axis} domain={[0, 100]} />
            <Tooltip contentStyle={tooltipStyle} labelFormatter={(n) => `test ${n}`} />
            <Line dataKey="consistency" stroke="var(--ft-brand)" strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ChartCard>
        <ChartCard title="Weekly progress (avg wpm)" empty={weekly.length < 2}>
          <LineChart data={weekly} margin={{ left: -16, right: 8 }}>
            <CartesianGrid stroke="var(--ft-surface-2)" vertical={false} />
            <XAxis dataKey="period" {...axis} />
            <YAxis {...axis} />
            <Tooltip contentStyle={tooltipStyle} />
            <Line dataKey="wpm" stroke="var(--ft-brand)" strokeWidth={2} isAnimationActive={false} />
          </LineChart>
        </ChartCard>
        <ChartCard title="Monthly progress (avg wpm)" empty={monthly.length < 2}>
          <LineChart data={monthly} margin={{ left: -16, right: 8 }}>
            <CartesianGrid stroke="var(--ft-surface-2)" vertical={false} />
            <XAxis dataKey="period" {...axis} />
            <YAxis {...axis} />
            <Tooltip contentStyle={tooltipStyle} />
            <Line dataKey="wpm" stroke="var(--ft-brand)" strokeWidth={2} isAnimationActive={false} />
          </LineChart>
        </ChartCard>
      </div>

      <Card className="mt-6">
        <h2 className="mb-3 text-sm font-medium text-sub">Test history</h2>
        {recent.length === 0 ? (
          <p className="text-sm text-sub">No tests in this range.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm tabular-nums">
              <thead className="text-xs uppercase tracking-wider text-sub">
                <tr>
                  <th className="py-2 pr-4 font-normal">date</th>
                  <th className="py-2 pr-4 font-normal">wpm</th>
                  <th className="py-2 pr-4 font-normal">raw</th>
                  <th className="py-2 pr-4 font-normal">acc</th>
                  <th className="py-2 pr-4 font-normal">consistency</th>
                  <th className="py-2 pr-4 font-normal">mode</th>
                  <th className="py-2 font-normal"><span className="sr-only">details</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-2">
                {recent.slice(0, shown).map((t) => (
                  <tr key={t.id}>
                    <td className="py-2 pr-4 text-sub">{new Date(t.createdAt).toLocaleString()}</td>
                    <td className="py-2 pr-4 text-text">{t.wpm.toFixed(1)}</td>
                    <td className="py-2 pr-4 text-sub">{t.raw.toFixed(1)}</td>
                    <td className="py-2 pr-4 text-text">{t.accuracy.toFixed(1)}%</td>
                    <td className="py-2 pr-4 text-sub">{Math.round(t.consistency)}%</td>
                    <td className="py-2 pr-4 text-sub">{modeLabel(t)}</td>
                    <td className="py-2">
                      <Link to={`/history/${t.id}`} className="text-brand hover:underline">view</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {recent.length > shown && (
              <button type="button" onClick={() => setShown((n) => n + 25)} className="mt-3 text-sm text-brand hover:underline">
                Show more
              </button>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
