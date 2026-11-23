import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AchievementIcon } from '../components/AchievementIcon';
import { Avatar } from '../components/Avatar';
import { Card, Notice, Stat } from '../components/ui';
import { achievements } from '../domain/achievements';
import { levelFromXp } from '../domain/progression';
import { getPublicProfile, type PublicProfile } from '../services/social';
import { errorMessage, isSupabaseConfigured } from '../services/supabase';

export default function PublicProfilePage() {
  const { username = '' } = useParams();
  const [p, setP] = useState<PublicProfile | null | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    getPublicProfile(username).then(setP, (e) => setErr(errorMessage(e)));
  }, [username]);

  if (!isSupabaseConfigured) return <Notice>Public profiles need online features to be configured.</Notice>;
  if (err) return <Notice tone="warn">{err}</Notice>;
  if (p === undefined) return <p className="text-sub">Loading…</p>;
  if (p === null) return <Notice>This profile doesn't exist or is private.</Notice>;

  return <ProfileCard p={p} />;
}

export function ProfileCard({ p }: { p: PublicProfile }) {
  const lvl = levelFromXp(p.total_xp);
  return (
    <div>
      <div className="mb-6 flex items-center gap-4">
        <Avatar avatar={p.avatar} username={p.username} size="lg" />
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold break-words text-text">{p.username}</h1>
          {p.bio && <p className="mt-1 text-sm break-words text-text/90">{p.bio}</p>}
          <p className="text-sm text-sub">Level {lvl.level} · joined {new Date(p.created_at).toLocaleDateString()}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Card><Stat label="total xp" value={p.total_xp} /></Card>
        <Card><Stat label="best wpm" value={Number(p.best_wpm).toFixed(1)} /></Card>
        <Card><Stat label="avg accuracy" value={`${Number(p.avg_accuracy).toFixed(1)}%`} /></Card>
        <Card><Stat label="tests" value={p.total_tests} /></Card>
        <Card><Stat label="streak" value={`${p.current_streak}d`} /></Card>
        <Card><Stat label="achievements" value={p.achievements.length} /></Card>
      </div>
      <ul className="mt-6 flex flex-wrap gap-2">
        {achievements
          .filter((a) => p.achievements.includes(a.id))
          .map((a) => (
            <li key={a.id} className="inline-flex items-center gap-2 rounded-full bg-surface px-3 py-1 text-sm text-text">
              <span className="text-brand"><AchievementIcon icon={a.icon} size={14} /></span>
              {a.title}
            </li>
          ))}
      </ul>
    </div>
  );
}
