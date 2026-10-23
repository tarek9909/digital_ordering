import { useTranslation } from '@dop/i18n';
import { useEffect, useRef, useState } from 'react';
import { BUFFER_IDLE_MS, isTextTarget, reduceKey, type ShortcutCommand } from '../lib/shortcuts';

/** Keyboard shortcuts (FR-STF-12, TR-FE-16); returns the digits typed so far. */
export function useShortcuts(dialogOpen: boolean, onCommand: (c: ShortcutCommand) => void): string {
  const [buffer, setBuffer] = useState('');
  const state = useRef({ buffer: '', dialogOpen, onCommand });
  state.current.dialogOpen = dialogOpen;
  state.current.onCommand = onCommand;

  useEffect(() => {
    let idle: ReturnType<typeof setTimeout> | undefined;
    const update = (b: string) => {
      state.current.buffer = b;
      setBuffer(b);
      clearTimeout(idle);
      if (b) idle = setTimeout(() => update(''), BUFFER_IDLE_MS);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat) return;
      const r = reduceKey(state.current.buffer, {
        key: e.key,
        code: e.code,
        ctrl: e.ctrlKey,
        meta: e.metaKey,
        alt: e.altKey,
        inTextField: isTextTarget(document.activeElement),
        dialogOpen: state.current.dialogOpen,
      });
      if (r.handled) e.preventDefault();
      if (r.buffer !== state.current.buffer) update(r.buffer);
      if (r.command) state.current.onCommand(r.command);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(idle);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // A dialog opening drops a half-typed number.
  useEffect(() => {
    if (dialogOpen && state.current.buffer) {
      state.current.buffer = '';
      setBuffer('');
    }
  }, [dialogOpen]);

  return buffer;
}

/** Small overlay with the typed number and what the keys do. */
export function KeyBuffer({ buffer, kitchen }: { buffer: string; kitchen: boolean }) {
  const { t } = useTranslation();
  if (!buffer) return null;
  return (
    <div className="pointer-events-none fixed start-4 bottom-24 z-30 flex min-w-48 flex-col gap-2 rounded-[var(--radius-card)] bg-ink px-6 py-4 text-white shadow-dialog" aria-hidden="true">
      <span className="num font-display text-6xl leading-none font-extrabold tracking-tight" dir="ltr">
        {buffer}
        <span className="ms-1 inline-block h-12 w-1 translate-y-1 rounded-full bg-white/40 motion-safe:animate-pulse" />
      </span>
      <span className="text-sm text-white/70">{kitchen ? t('keys.hintKitchen') : t('keys.hint')}</span>
    </div>
  );
}
