import { useTranslation } from '@dop/i18n';
import { Button } from '@dop/ui';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Icon } from '../components/Icon';
import { LangSwitch } from '../components/LangSwitch';
import { unlockChime } from '../lib/chime';
import { switchMember, useMember } from '../lib/member';
import { useStaff } from '../lib/store';
import type { Counts } from '../lib/ticketState';
import { CLAIMS_PANEL_ID } from './ClaimsPanel';

export function ConnectionDot() {
  const { t } = useTranslation();
  const state = useStaff((s) => (s.socketUp === false ? 'offline' : s.socketUp === null || s.needsReload ? 'connecting' : 'live'));
  const color = state === 'live' ? 'bg-ok' : state === 'connecting' ? 'bg-[#d97706]' : 'bg-danger';
  return (
    <span className="inline-flex items-center gap-2 text-sm font-medium">
      <span className={`inline-block size-3 rounded-full ${color}`} aria-hidden="true" />
      {t(`connection.${state}`)}
    </span>
  );
}

/** Named staff (FR-ACC-07): who is signed in, with Switch; or a PIN button once named staff are in use. */
export function MemberChip({ dark = false }: { dark?: boolean }) {
  const { t } = useTranslation();
  const session = useMember((s) => s.session);
  const namedStaff = useMember((s) => s.namedStaff);
  if (!session && !namedStaff) return null;
  const box = dark ? 'border-white/30' : 'border-line';
  return (
    <div className={`flex items-center gap-2 rounded-lg border ps-3 ${box}`}>
      <span className="inline-flex items-center gap-1 text-sm font-medium">
        <Icon name="person" className="size-4" />
        {session ? t('member.signedInAs', { name: session.name }) : t('member.nobody')}
      </span>
      <button type="button" onClick={switchMember} className={`min-h-12 rounded-e-lg px-3 font-semibold ${dark ? 'hover:bg-white/10' : 'hover:bg-canvas'}`}>
        {session ? t('member.switch') : t('member.enterPin')}
      </button>
    </div>
  );
}

/** One-time tap that allows the POS chime (FR-STF-16); browsers block audio until a tap. */
export function SoundButton() {
  const { t } = useTranslation();
  const on = useStaff((s) => s.soundEnabled);
  if (on)
    return (
      <span className="inline-flex items-center gap-1 text-sm font-medium" role="status">
        <Icon name="sound" className="size-4" />
        {t('pos.soundOn')}
      </span>
    );
  return (
    <Button
      variant="secondary"
      onClick={() => void unlockChime().then((ok) => ok && useStaff.getState().setSoundEnabled(true))}
    >
      <Icon name="sound" />
      {t('pos.enableSound')}
    </Button>
  );
}

function ClaimsBadge({ count }: { count: number }) {
  const { t } = useTranslation();
  if (count === 0) return null;
  return (
    <Button
      variant="secondary"
      className="border-[#d97706] font-bold"
      aria-label={t('claims.badge', { count })}
      onClick={() => document.getElementById(CLAIMS_PANEL_ID)?.focus()}
    >
      <Icon name="phone" />
      <span className="hidden sm:inline">{t('claims.title')}</span>
      <span className="num rounded-full bg-[#d97706] px-2 text-white">{count}</span>
    </Button>
  );
}

interface Props {
  venueName: string;
  claimCount: number;
  showSound: boolean;
  counts: Counts;
  showReceived: boolean;
  canCreate: boolean;
  disabled: boolean;
  onNew: () => void;
  onSearch: (q: string) => void;
  onRecent: () => void;
}

/** Top bar (FR-STF-01): venue, New ticket, search, connection, today's counts. */
export function TopBar({ venueName, claimCount, showSound, counts, showReceived, canCreate, disabled, onNew, onSearch, onRecent }: Props) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSearch(q);
    setQ('');
  };
  return (
    <header className="border-b border-line bg-surface px-3 py-2">
      <div className="flex flex-wrap items-center gap-3">
        <div className="me-auto flex min-w-0 flex-col">
          <h1 className="truncate text-xl font-bold">{venueName}</h1>
          <div className="flex flex-wrap items-center gap-x-3 text-sm text-muted">
            <ConnectionDot />
            {showReceived && (
              <span>
                {t('common:status.received')}: <span className="num">{counts.received}</span>
              </span>
            )}
            <span>
              {t('common:status.preparing')}: <span className="num">{counts.preparing}</span>
            </span>
            <span>
              {t('common:status.ready')}: <span className="num">{counts.ready}</span>
            </span>
            <span>
              {t(counts.collectedScope === 'today' ? 'collectedToday' : 'collectedRecent')}:<span className="num">{counts.collected}</span>
            </span>
          </div>
        </div>
        <form onSubmit={submit} role="search" className="flex items-center gap-1">
          <label htmlFor="board-search" className="sr-only">
            {t('search.label')}
          </label>
          <input
            id="board-search"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('search.placeholder')}
            className="min-h-12 w-36 rounded-lg border border-line bg-surface px-3 sm:w-48"
          />
          <Button type="submit" variant="secondary" aria-label={t('search.go')}>
            <Icon name="search" />
          </Button>
        </form>
        <ClaimsBadge count={claimCount} />
        <MemberChip />
        {showSound && <SoundButton />}
        <Button variant="secondary" onClick={onRecent} aria-label={t('recent.title')}>
          <Icon name="history" />
          <span className="hidden sm:inline">{t('recent.title')}</span>
        </Button>
        <LangSwitch />
        <Link to="/device" className="inline-flex size-12 items-center justify-center rounded-lg hover:bg-canvas" aria-label={t('device.title')}>
          <Icon name="device" />
        </Link>
        {canCreate && (
          <Button size="lg" className="w-full sm:w-auto" disabled={disabled} onClick={onNew}>
            <Icon name="plus" className="size-6" />
            {t('newTicket.button')}
          </Button>
        )}
      </div>
    </header>
  );
}
