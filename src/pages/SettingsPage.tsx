import { useEffect, useState } from 'react';
import { Button, Card, Notice, PageTitle, Segmented, Toggle } from '../components/ui';
import { languages } from '../data/wordlists';
import { emptyProgress } from '../persistence/storage';
import { loadProfile, useAuth } from '../state/auth';
import { progressStore, updateSettings, useSettings } from '../state/store';
import { updateProfile } from '../services/social';
import { AccountDataSettings, AccountSettings, GuestAccountSettings } from '../components/AccountSettings';
import { errorMessage } from '../services/supabase';
import type { Settings } from '../types';

function Row({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="text-text">{title}</div>
        {description && <div className="text-sm text-sub">{description}</div>}
      </div>
      {children}
    </div>
  );
}

export default function SettingsPage() {
  const s = useSettings();
  const auth = useAuth();
  const [privacyErr, setPrivacyErr] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const set = <K extends keyof Settings>(k: K) => (v: Settings[K]) => updateSettings({ [k]: v } as Partial<Settings>);

  const [privacyBusy, setPrivacyBusy] = useState(false);

  // Scroll to #account / #privacy / #data after the lazy page mounts (the browser tried before it existed).
  useEffect(() => {
    if (window.location.hash) document.getElementById(window.location.hash.slice(1))?.scrollIntoView();
  }, []);

  // Signed in, the server profile is the source of truth; the toggles show it and write to it.
  // Signed out, they show what a new account starts with.
  const privacy = auth.profile
    ? { publicProfile: auth.profile.is_public, showOnLeaderboard: auth.profile.show_on_leaderboard }
    : { publicProfile: true, showOnLeaderboard: true };

  const setPrivacy = async (patch: { publicProfile?: boolean; showOnLeaderboard?: boolean }) => {
    if (!auth.user || privacyBusy) return;
    setPrivacyErr(null);
    setPrivacyBusy(true);
    try {
      await updateProfile(auth.user.id, {
        ...(patch.publicProfile !== undefined && { is_public: patch.publicProfile }),
        ...(patch.showOnLeaderboard !== undefined && { show_on_leaderboard: patch.showOnLeaderboard }),
      });
      await loadProfile();
    } catch (e) {
      setPrivacyErr(errorMessage(e));
    } finally {
      setPrivacyBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageTitle>Settings</PageTitle>

      <nav aria-label="Settings sections" className="-mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-sub">
        {[['account', 'Account'], ['privacy', 'Privacy'], ['data', 'Data'], ['appearance', 'Appearance'], ['test', 'Test']].map(([id, label]) => (
          <a key={id} href={`#${id}`} className="hover:text-text">
            {label}
          </a>
        ))}
      </nav>

      {auth.user ? <AccountSettings /> : <GuestAccountSettings />}

      <Card>
        <h2 id="privacy" className="mb-2 text-lg font-medium text-text">Privacy</h2>
        {auth.user ? (
          <p className="mb-2 text-sm text-sub">Both are on for new accounts. Turn either off any time; a private profile is visible only to you.</p>
        ) : (
          <p className="mb-2 text-sm text-sub">New accounts start with both on; change them here once you sign in. Without an account nothing leaves this browser.</p>
        )}
        <fieldset disabled={!auth.profile} aria-busy={privacyBusy} className="disabled:opacity-60 [&:disabled_label]:cursor-default">
          <Toggle label="Public profile" description="Others can view your username, avatar, bio, stats and achievements." checked={privacy.publicProfile} onChange={(v) => void setPrivacy({ publicProfile: v })} />
          <Toggle label="Show me on leaderboards" description="Your username and best ranked results appear on global and friends boards." checked={privacy.showOnLeaderboard} onChange={(v) => void setPrivacy({ showOnLeaderboard: v })} />
        </fieldset>
        {privacyErr && <Notice tone="warn">{privacyErr}</Notice>}
      </Card>

      <Card>
        <h2 id="data" className="mb-2 text-lg font-medium text-text">Data</h2>
        {auth.user && (
          <div className="mb-6 border-b border-surface-2 pb-6">
            <AccountDataSettings />
          </div>
        )}
        <h3 className="mb-1 font-medium text-text">This browser</h3>
        <p className="mb-3 text-sm text-sub">Remove all tests, XP, achievements and lesson progress stored in this browser. Your cloud account (if any) is not affected.</p>
        {confirmClear ? (
          <div className="flex gap-2">
            <Button
              variant="danger"
              onClick={() => {
                progressStore.set(emptyProgress());
                setConfirmClear(false);
              }}
            >
              Yes, delete local data
            </Button>
            <Button variant="ghost" onClick={() => setConfirmClear(false)}>Cancel</Button>
          </div>
        ) : (
          <Button variant="danger" onClick={() => setConfirmClear(true)}>Clear local data…</Button>
        )}
      </Card>

      <Card>
        <h2 id="appearance" className="mb-2 text-lg font-medium text-text">Appearance</h2>
        <div className="divide-y divide-surface-2">
          <Row title="Theme">
            <Segmented label="Theme" value={s.theme} onChange={set('theme')} options={[{ value: 'frog', label: 'Frog' }, { value: 'swamp', label: 'Swamp' }, { value: 'lily', label: 'Lily (light)' }]} />
          </Row>
          <Row title="Font family">
            <Segmented label="Font family" value={s.fontFamily} onChange={set('fontFamily')} options={[{ value: 'mono', label: 'Mono' }, { value: 'sans', label: 'Sans' }, { value: 'serif', label: 'Serif' }]} />
          </Row>
          <Row title="Font size" description={`${s.fontSize.toFixed(2)} rem`}>
            <input type="range" aria-label="Font size" min={1} max={3.5} step={0.25} value={s.fontSize} onChange={(e) => set('fontSize')(Number(e.target.value))} className="w-48 accent-[var(--ft-brand)]" />
          </Row>
          <Row title="Caret style">
            <Segmented label="Caret style" value={s.caretStyle} onChange={set('caretStyle')} options={[{ value: 'line', label: 'Line' }, { value: 'block', label: 'Block' }, { value: 'underline', label: 'Underline' }, { value: 'off', label: 'Off' }]} />
          </Row>
          <Row title="Reduced motion" description="System follows your OS setting.">
            <Segmented label="Reduced motion" value={s.reducedMotion} onChange={set('reducedMotion')} options={[{ value: 'system', label: 'System' }, { value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]} />
          </Row>
          <Toggle label="Live WPM" description="Show speed and accuracy while typing." checked={s.showLiveWpm} onChange={set('showLiveWpm')} />
        </div>
      </Card>

      <Card>
        <h2 id="test" className="mb-2 text-lg font-medium text-text">Test</h2>
        <div className="divide-y divide-surface-2">
          <Row title="Default mode">
            <Segmented label="Default mode" value={s.defaultMode} onChange={set('defaultMode')} options={[{ value: 'time', label: 'Time' }, { value: 'words', label: 'Words' }]} />
          </Row>
          <Row title="Test duration" description="Seconds, for time mode">
            <Segmented label="Test duration" value={s.timeDuration} onChange={set('timeDuration')} options={[15, 30, 60, 120].map((v) => ({ value: v, label: String(v) }))} />
          </Row>
          <Row title="Word count" description="For words mode">
            <Segmented label="Word count" value={s.wordCount} onChange={set('wordCount')} options={[10, 25, 50, 100].map((v) => ({ value: v, label: String(v) }))} />
          </Row>
          <Row title="Difficulty" description="Easy: short words. Hard: long and uncommon words.">
            <Segmented label="Difficulty" value={s.difficulty} onChange={set('difficulty')} options={[{ value: 'easy', label: 'Easy' }, { value: 'normal', label: 'Normal' }, { value: 'hard', label: 'Hard' }]} />
          </Row>
          <Row title="Language">
            <Segmented label="Language" value={s.language} onChange={set('language')} options={languages} />
          </Row>
          <Toggle label="Punctuation" checked={s.punctuation} onChange={set('punctuation')} />
          <Toggle label="Numbers" checked={s.numbers} onChange={set('numbers')} />
          <Row title="Sound effects">
            <Segmented label="Sound effects" value={s.sound} onChange={set('sound')} options={[{ value: 'off', label: 'Off' }, { value: 'click', label: 'Click' }, { value: 'soft', label: 'Soft' }]} />
          </Row>
        </div>
      </Card>

    </div>
  );
}
