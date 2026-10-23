import { useTranslation } from '@dop/i18n';
import { BrandMark, Button } from '@dop/ui';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Icon } from '../components/Icon';
import { LangSwitch } from '../components/LangSwitch';
import { unlockChime } from '../lib/chime';
import { switchMember, useMember } from '../lib/member';
import { useStaff } from '../lib/store';
import { CLAIMS_PANEL_ID } from './ClaimsPanel';

/** Round 48 px icon control used across the bar (ghost on white, or on ink in kitchen mode). */
export const iconButton = (dark = false) =>
  `inline-flex size-12 shrink-0 items-center justify-center rounded-full transition-colors ${dark ? 'text-white/85 hover:bg-white/10' : 'text-ink-2 hover:bg-canvas hover:text-ink'}`;

/** Live / connecting / offline: a shape as well as a colour (circle, diamond, square); the live dot breathes. */
export function ConnectionDot({ dark = false }: { dark?: boolean }) {
  const { t } = useTranslation();
  const state = useStaff((s) => (s.socketUp === false ? 'offline' : s.socketUp === null || s.needsReload ? 'connecting' : 'live'));
  const mark = state === 'live' ? 'rounded-full bg-ok' : state === 'connecting' ? 'rotate-45 rounded-[2px] bg-warn' : 'rounded-[2px] bg-danger';
  return (
    <span className={`inline-flex items-center gap-2 text-sm font-medium ${dark ? 'text-white/80' : 'text-ink-2'}`}>
      <span className="relative inline-flex size-2.5" aria-hidden="true">
        {state === 'live' && <span className="absolute inset-0 rounded-full bg-ok opacity-60 motion-safe:animate-ping" />}
        <span className={`relative inline-block size-2.5 ${mark}`} />
      </span>
      {t(`connection.${state}`)}
    </span>
  );
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

/** Named staff (FR-ACC-07): who is signed in, with Switch; or a PIN button once named staff are in use. */
export function MemberChip({ dark = false }: { dark?: boolean }) {
  const { t } = useTranslation();
  const session = useMember((s) => s.session);
  const namedStaff = useMember((s) => s.namedStaff);
  if (!session && !namedStaff) return null;
  return (
    <div className={`flex min-h-12 shrink-0 items-center gap-2 rounded-control ps-1.5 ring-1 ring-inset ${dark ? 'ring-white/20' : 'bg-surface ring-line'}`}>
      <span
        aria-hidden="true"
        className={`grid size-9 shrink-0 place-items-center rounded-full font-display text-sm font-bold ${session ? (dark ? 'bg-white text-ink' : 'bg-ink text-white') : dark ? 'bg-white/10' : 'bg-canvas text-muted'}`}
      >
        {session ? initials(session.name) || '•' : <Icon name="person" className="size-4" />}
      </span>
      <span className={`hidden max-w-40 truncate text-sm font-medium 2xl:inline ${dark ? 'text-white/85' : 'text-ink-2'}`}>
        {session ? t('member.signedInAs', { name: session.name }) : t('member.nobody')}
      </span>
      <button
        type="button"
        onClick={switchMember}
        className={`min-h-12 rounded-e-full px-3 text-sm font-semibold whitespace-nowrap sm:px-4 transition-colors ${dark ? 'text-white hover:bg-white/10' : 'text-ink hover:bg-canvas'}`}
      >
        {session ? t('member.switch') : t('member.enterPin')}
      </button>
    </div>
  );
}

/** One-time tap that allows the POS chime (FR-STF-16); browsers block audio until a tap. */
export function SoundButton({ dark = false }: { dark?: boolean }) {
  const { t } = useTranslation();
  const on = useStaff((s) => s.soundEnabled);
  if (on)
    return (
      <span className={`inline-flex min-h-12 items-center gap-1.5 px-2 text-sm font-medium ${dark ? 'text-white/80' : 'text-ink-2'}`} role="status">
        <Icon name="sound" className="size-4" />
        {/* Phones: the icon alone keeps the bar compact; the words stay for screen readers. */}
        <span className="max-sm:sr-only">{t('pos.soundOn')}</span>
      </span>
    );
  return (
    <button
      type="button"
      className={`inline-flex min-h-12 min-w-12 shrink-0 items-center justify-center gap-2 rounded-control px-3 font-semibold ring-1 ring-inset transition-colors sm:px-4 ${dark ? 'text-white ring-white/25 hover:bg-white/10' : 'bg-surface text-ink ring-line hover:bg-canvas'}`}
      onClick={() => void unlockChime().then((ok) => ok && useStaff.getState().setSoundEnabled(true))}
    >
      <Icon name="sound" />
      <span className="max-sm:sr-only">{t('pos.enableSound')}</span>
    </button>
  );
}

function ClaimsBadge({ count }: { count: number }) {
  const { t } = useTranslation();
  if (count === 0) return null;
  return (
    <button
      type="button"
      className="hidden min-h-12 items-center gap-2 rounded-control bg-warn-bg ps-4 pe-2 sm:inline-flex font-semibold text-warn transition-[filter] hover:brightness-95"
      aria-label={t('claims.badge', { count })}
      onClick={() => document.getElementById(CLAIMS_PANEL_ID)?.focus()}
    >
      <Icon name="phone" />
      <span className="hidden lg:inline">{t('claims.title')}</span>
      <span className="num grid min-w-8 place-items-center rounded-full bg-warn px-2 py-0.5 text-sm font-bold text-white">{count}</span>
    </button>
  );
}

interface Props {
  venueName: string;
  claimCount: number;
  showSound: boolean;
  canCreate: boolean;
  disabled: boolean;
  onNew: () => void;
  onSearch: (q: string) => void;
  onRecent: () => void;
}

/** Top bar (FR-STF-01): venue and connection, search, claims, Recent, and the one ember action: New ticket. */
export function TopBar({ venueName, claimCount, showSound, canCreate, disabled, onNew, onSearch, onRecent }: Props) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSearch(q);
    setQ('');
  };
  return (
    <header className="border-b border-line bg-surface/95 px-3 pt-[max(0.625rem,env(safe-area-inset-top))] pb-2.5 backdrop-blur sm:px-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2.5">
        <div className="me-auto flex min-w-0 flex-1 basis-40 items-center gap-3 sm:flex-none sm:basis-auto">
          <BrandMark className="size-10" />
          <div className="flex min-w-0 flex-col">
            <h1 className="truncate font-display text-lg leading-tight font-bold tracking-tight sm:text-xl">{venueName}</h1>
            <ConnectionDot />
          </div>
        </div>

        <form onSubmit={submit} role="search" className="relative hidden items-center sm:flex">
          <label htmlFor="board-search" className="sr-only">
            {t('search.label')}
          </label>
          <Icon name="search" className="pointer-events-none absolute start-4 size-5 text-muted" />
          <input
            id="board-search"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('search.placeholder')}
            enterKeyHint="search"
            className="min-h-12 w-40 rounded-control border border-line bg-canvas ps-11 pe-4 text-base placeholder:text-muted hover:border-ink-2/30 md:w-44 lg:w-56"
          />
          <button type="submit" className="sr-only">
            {t('search.go')}
          </button>
        </form>
        <button type="button" className={`${iconButton()} sm:hidden`} aria-label={t('search.title')} onClick={() => onSearch('')}>
          <Icon name="search" />
        </button>

        <ClaimsBadge count={claimCount} />
        <MemberChip />
        {showSound && <SoundButton />}
        <button type="button" onClick={onRecent} aria-label={t('recent.title')} className={`${iconButton()} 2xl:w-auto 2xl:gap-2 2xl:rounded-control 2xl:px-4 2xl:font-semibold`}>
          <Icon name="history" />
          <span className="hidden 2xl:inline">{t('recent.title')}</span>
        </button>
        {/* Phones: the language switch lives on the device page, keeping the bar to one row. */}
        <LangSwitch className="max-sm:hidden" />
        <Link to="/device" className={iconButton()} aria-label={t('device.title')}>
          <Icon name="device" />
        </Link>
        {canCreate && (
          <Button size="lg" className="w-full sm:ms-1 sm:w-auto" disabled={disabled} onClick={onNew}>
            <Icon name="plus" className="size-6" />
            {t('newTicket.button')}
          </Button>
        )}
      </div>
    </header>
  );
}
