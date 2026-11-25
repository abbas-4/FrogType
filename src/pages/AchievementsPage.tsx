import { AchievementIcon } from '../components/AchievementIcon';
import { Card, PageTitle } from '../components/ui';
import { achievements } from '../domain/achievements';
import { levelFromXp, totalXp } from '../domain/progression';
import { useProgress } from '../state/store';

export default function AchievementsPage() {
  const progress = useProgress();
  const xp = totalXp(progress.xp);
  const lvl = levelFromXp(xp);
  const unlocked = achievements.filter((a) => progress.achievements[a.id]).length;
  const recentXp = [...progress.xp].reverse().slice(0, 12);

  return (
    <div>
      <PageTitle sub={`${unlocked} of ${achievements.length} unlocked`}>Achievements</PageTitle>
      <Card className="mb-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-wider text-sub">level</div>
            <div className="text-4xl font-semibold text-brand tabular-nums">{lvl.level}</div>
          </div>
          <div className="text-right text-sm text-sub tabular-nums">
            {lvl.into} / {lvl.needed} XP to level {lvl.level + 1} · {xp} XP total
          </div>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-label="XP to next level" aria-valuenow={lvl.into} aria-valuemin={0} aria-valuemax={lvl.needed}>
          <div className="h-full bg-brand" style={{ width: `${lvl.progress * 100}%` }} />
        </div>
      </Card>

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {achievements.map((a) => {
          const at = progress.achievements[a.id];
          return (
            <li key={a.id} data-state={at ? 'unlocked' : 'locked'} className={`flex gap-3 rounded-lg border p-4 ${at ? 'border-brand/30 bg-surface' : 'border-transparent bg-surface/50'}`}>
              <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-lg ${at ? 'bg-brand/10 text-text' : 'bg-surface-2/60 text-sub'}`}>
                <AchievementIcon icon={a.icon} size={36} unlocked={!!at} />
              </span>
              <span>
                <span className={`block font-medium ${at ? 'text-text' : 'text-sub'}`}>{a.title}</span>
                <span className="block text-sm text-sub">{a.description}</span>
                <span className={`mt-1 block text-xs ${at ? 'text-brand' : 'text-sub'}`}>{at ? `Unlocked ${new Date(at).toLocaleDateString()}` : 'Locked'}</span>
              </span>
            </li>
          );
        })}
      </ul>

      <Card className="mt-6">
        <h2 className="mb-3 text-sm font-medium text-sub">Recent XP</h2>
        {recentXp.length === 0 ? (
          <p className="text-sm text-sub">Complete tests, lessons and daily challenges to earn XP.</p>
        ) : (
          <ul className="divide-y divide-surface-2 text-sm">
            {recentXp.map((t) => (
              <li key={t.key} className="flex justify-between py-2">
                <span className="text-text">{t.reason}</span>
                <span className="text-brand tabular-nums">+{t.amount}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
