import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ShieldAlert, UserPlus } from 'lucide-react';
import { Button, Card, Notice, PageTitle, Segmented } from '../components/ui';
import { useAuth } from '../state/auth';
import { getLeaderboard, listFriends, removeFriend, respondFriendRequest, sendFriendRequest, type Friend, type LeaderboardRow } from '../services/social';
import { errorMessage, isSupabaseConfigured } from '../services/supabase';

const BOARDS = [
  { value: 'time-15', label: 'time 15' },
  { value: 'time-30', label: 'time 30' },
  { value: 'time-60', label: 'time 60' },
  { value: 'time-120', label: 'time 120' },
  { value: 'words-10', label: 'words 10' },
  { value: 'words-25', label: 'words 25' },
  { value: 'words-50', label: 'words 50' },
  { value: 'words-100', label: 'words 100' },
] as const;
type Board = (typeof BOARDS)[number]['value'];

export default function LeaderboardsPage() {
  const auth = useAuth();
  const [scope, setScope] = useState<'global' | 'friends'>('global');
  const [board, setBoard] = useState<Board>('time-60');
  const queryKey = `${scope}:${board}:${auth.user?.id ?? ''}`;
  const [data, setData] = useState<{ key: string; rows: LeaderboardRow[] | null; err: string | null }>({ key: '', rows: null, err: null });
  const loaded = data.key === queryKey;
  const rows = loaded ? data.rows : null;
  const err = loaded ? data.err : null;

  useEffect(() => {
    if (!isSupabaseConfigured || (scope === 'friends' && !auth.user)) return;
    const [mode, mode2] = board.split('-') as ['time' | 'words', string];
    let cancelled = false;
    getLeaderboard(scope, mode, Number(mode2)).then(
      (r) => !cancelled && setData({ key: queryKey, rows: r, err: null }),
      (e) => !cancelled && setData({ key: queryKey, rows: null, err: errorMessage(e) }),
    );
    return () => {
      cancelled = true;
    };
  }, [scope, board, auth.user, queryKey]);

  return (
    <div>
      <PageTitle sub="Best verified result per user: English, normal difficulty, no punctuation or numbers, standard time and word modes.">Leaderboards</PageTitle>
      {!isSupabaseConfigured ? (
        <Notice>
          Leaderboards need online features. This installation has no Supabase project configured, so no rankings are shown (and none are faked). See the README to
          enable them.
        </Notice>
      ) : (
        <>
          <p className="mb-4 flex items-start gap-2 text-sm text-sub">
            <ShieldAlert size={16} className="mt-0.5 shrink-0 text-brand" aria-hidden="true" />
            Only results typed on a passage issued by the server and re-scored there from your keystrokes are listed. This blocks forged and replayed scores, but a
            modified client or a typing bot can still produce a plausible keystroke log, so rankings are <strong className="font-medium text-text">not proof of human typing</strong>.
          </p>
          <div className="mb-4 flex flex-wrap items-center gap-4">
            <Segmented label="Leaderboard scope" value={scope} onChange={setScope} options={[{ value: 'global', label: 'Global' }, { value: 'friends', label: 'Friends' }]} />
            <Segmented label="Test mode" value={board} onChange={setBoard} options={BOARDS.map((b) => ({ value: b.value, label: b.label }))} />
          </div>
          {scope === 'friends' && !auth.user ? (
            <Notice>
              <Link to="/profile" className="text-brand underline">Sign in</Link> to compare results with friends.
            </Notice>
          ) : (
            <Card>
              {err ? (
                <Notice tone="warn">{err}</Notice>
              ) : rows === null ? (
                <p className="text-sub">Loading…</p>
              ) : rows.length === 0 ? (
                <p className="text-sub">No results yet for this board{scope === 'friends' ? ' among you and your friends' : ''}.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm tabular-nums">
                    <thead className="text-xs uppercase tracking-wider text-sub">
                      <tr>
                        {['#', 'user', 'wpm', 'accuracy', 'mode', 'duration', 'date'].map((h) => (
                          <th key={h} className="py-2 pr-4 font-normal">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-2">
                      {rows.map((r) => (
                        <tr key={`${r.rank}-${r.username}`} className={r.username === auth.profile?.username ? 'text-brand' : ''}>
                          <td className="py-2 pr-4 text-sub">{r.rank}</td>
                          <td className="py-2 pr-4"><Link to={`/u/${r.username}`} className="hover:underline">{r.username}</Link></td>
                          <td className="py-2 pr-4">{Number(r.wpm).toFixed(1)}</td>
                          <td className="py-2 pr-4">{Number(r.accuracy).toFixed(1)}%</td>
                          <td className="py-2 pr-4 text-sub">{r.mode} {r.mode2}</td>
                          <td className="py-2 pr-4 text-sub">{(r.duration_ms / 1000).toFixed(1)}s</td>
                          <td className="py-2 pr-4 text-sub">{new Date(r.created_at).toLocaleDateString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}
          {auth.user && <FriendsPanel />}
        </>
      )}
    </div>
  );
}

function FriendsPanel() {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [name, setName] = useState('');
  const [msg, setMsg] = useState<{ text: string; tone: 'info' | 'warn' } | null>(null);

  const refresh = useCallback(() => listFriends().then(setFriends, (e) => setMsg({ text: errorMessage(e), tone: 'warn' })), []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const act = async (fn: () => Promise<void>, ok?: string) => {
    try {
      await fn();
      if (ok) setMsg({ text: ok, tone: 'info' });
      await refresh();
    } catch (e) {
      setMsg({ text: errorMessage(e), tone: 'warn' });
    }
  };

  return (
    <Card className="mt-6">
      <h2 className="mb-3 text-lg font-medium text-text">Friends</h2>
      <form
        className="flex max-w-md gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void act(() => sendFriendRequest(name), `If ${name} exists, they will see your request.`).then(() => setName(''));
        }}
      >
        <label htmlFor="friend-name" className="sr-only">Friend's username</label>
        <input id="friend-name" required pattern="[A-Za-z0-9_]{3,20}" placeholder="username" value={name} onChange={(e) => setName(e.target.value)} className="flex-1 rounded-lg bg-surface-2 px-3 py-2 text-text" />
        <Button type="submit"><UserPlus size={16} /> Add</Button>
      </form>
      {msg && <div className="mt-3"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
      {friends.length === 0 ? (
        <p className="mt-4 text-sm text-sub">No friends yet. Add someone by username.</p>
      ) : (
        <ul className="mt-4 divide-y divide-surface-2 text-sm">
          {friends.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <Link to={`/u/${f.username}`} className="text-text hover:underline">{f.username}</Link>
              <span className="flex items-center gap-2">
                {f.status === 'pending' && f.direction === 'incoming' ? (
                  <>
                    <Button onClick={() => void act(() => respondFriendRequest(f.id, true))}>Accept</Button>
                    <Button variant="ghost" onClick={() => void act(() => respondFriendRequest(f.id, false))}>Decline</Button>
                  </>
                ) : (
                  <>
                    {f.status === 'pending' && <span className="text-sub">pending</span>}
                    <Button variant="ghost" onClick={() => void act(() => removeFriend(f.id))}>{f.status === 'pending' ? 'Cancel' : 'Remove'}</Button>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
