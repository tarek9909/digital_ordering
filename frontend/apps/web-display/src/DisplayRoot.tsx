import { useTranslation } from '@dop/i18n';
import { BrandMark, Button, Spinner } from '@dop/ui';
import { useEffect, useState } from 'react';
import { BoardView } from './components/BoardView';
import { PairingScreen } from './components/PairingScreen';
import { SoundOverlay } from './components/SoundOverlay';
import { errorText, isUnauthenticated } from './lib/api';
import { burnInShift, isTenantBlocked, msUntilNextHour } from './lib/board';
import { useBoardQuery, useDisplaySocket, useVoiceCheck } from './useDisplayBoard';

const SHIFT_EVERY_MS = 10 * 60_000;
const RELOAD_HOUR = 5;

/** Moves the whole layout by up to 4 px every 10 minutes (TR-FE-19). */
function useBurnIn() {
  const [shift, setShift] = useState({ x: 0, y: 0 });
  useEffect(() => {
    const id = setInterval(() => setShift(burnInShift(Math.random)), SHIFT_EVERY_MS);
    return () => clearInterval(id);
  }, []);
  return shift;
}

/** Reloads once a day at 05:00 local time to pick up new versions (TR-FE-20). */
function useDailyReload() {
  useEffect(() => {
    const id = setTimeout(() => window.location.reload(), msUntilNextHour(RELOAD_HOUR, new Date()));
    return () => clearTimeout(id);
  }, []);
}

function Centered({ children, mark = true }: { children: React.ReactNode; mark?: boolean }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-[3vmin] p-[6vmin] text-center">
      {mark && <BrandMark className="mb-[1vmin] size-[9vmin]" />}
      {children}
    </main>
  );
}

export function DisplayRoot() {
  const { t } = useTranslation();
  const query = useBoardQuery();
  const unpaired = isUnauthenticated(query.error);
  const board = unpaired ? undefined : query.data;
  useDisplaySocket(Boolean(board));
  useVoiceCheck(board?.settings.announce.languages, board?.voices);
  useDailyReload();
  const shift = useBurnIn();

  let content: React.ReactNode;
  if (unpaired) content = <PairingScreen />;
  else if (board && isTenantBlocked(board.tenantStatus))
    content = (
      <Centered>
        <h1 className="font-display text-[6.4vmin] leading-tight font-extrabold tracking-tight">{t('blocked.title')}</h1>
        <p className="max-w-[80vmin] text-[3.2vmin] leading-snug text-ink-2">{t('blocked.body')}</p>
      </Centered>
    );
  else if (board)
    content = (
      <>
        <BoardView board={board} />
        <SoundOverlay />
      </>
    );
  else if (query.error)
    content = (
      <Centered>
        <h1 className="max-w-[90vmin] text-[5vmin] leading-tight font-extrabold tracking-tight">{errorText(t, query.error)}</h1>
        <Button size="xl" onClick={() => void query.refetch()}>
          {t('common:retry')}
        </Button>
      </Centered>
    );
  else
    content = (
      <Centered mark={false}>
        <Spinner label={t('common:loading')} />
      </Centered>
    );

  return (
    <div className="min-h-dvh bg-surface text-ink" style={{ transform: `translate(${shift.x}px, ${shift.y}px)` }}>
      {content}
    </div>
  );
}
