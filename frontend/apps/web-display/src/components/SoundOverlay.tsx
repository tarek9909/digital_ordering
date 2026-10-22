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
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-[3vmin] bg-ink/95 text-white"
      autoFocus
    >
      <svg viewBox="0 0 24 24" className="size-[16vmin] text-glow" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
        <path d="M3 10v4h4l6 5V5L7 10H3zm13.5-2.5a6 6 0 0 1 0 9M19 5a9.5 9.5 0 0 1 0 14" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="font-display text-[6vmin] font-bold">{t('sound.enable')}</span>
      <span className="text-[3vmin] text-white/70">{t('sound.hint')}</span>
    </button>
  );
}
