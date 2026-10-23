import { useTranslation } from '@dop/i18n';
import { useEffect, useState } from 'react';
import { audioAlreadyAllowed, unlockSound } from '../lib/sound';
import { useDisplay } from '../lib/store';

/** "Tap to enable sound", shown once after start unless the browser already allows audio (TR-ALR-18). */
export function SoundOverlay() {
  const { t } = useTranslation();
  const enabled = useDisplay((s) => s.soundEnabled);
  const [checked, setChecked] = useState(false);
  const [tapped, setTapped] = useState(false);

  useEffect(() => {
    void audioAlreadyAllowed().then((ok) => {
      if (ok) useDisplay.getState().setSoundEnabled(true);
      setChecked(true);
    });
  }, []);

  if (enabled || tapped || !checked) return null;

  const enable = async () => {
    setTapped(true);
    const ok = await unlockSound();
    useDisplay.getState().setSoundEnabled(ok);
  };

  return (
    <button
      type="button"
      onClick={() => void enable()}
      className="ember-glow fixed inset-0 z-50 flex flex-col items-center justify-center gap-[3.4vmin] bg-ink p-[6vmin] text-center text-white focus-visible:outline-none"
      autoFocus
    >
      <span aria-hidden="true" className="sound-disc flex size-[22vmin] items-center justify-center rounded-full bg-white/[0.06] ring-[0.4vmin] ring-white/15">
        <svg viewBox="0 0 24 24" className="size-[11vmin] text-glow" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
          <path d="M3 10v4h4l6 5V5L7 10H3zm13.5-2.5a6 6 0 0 1 0 9M19 5a9.5 9.5 0 0 1 0 14" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span className="font-display text-[6.4vmin] leading-tight font-extrabold tracking-tight">{t('sound.enable')}</span>
      <span className="max-w-[80vmin] text-[max(1rem,2.8vmin)] leading-snug text-white/65">{t('sound.hint')}</span>
    </button>
  );
}
