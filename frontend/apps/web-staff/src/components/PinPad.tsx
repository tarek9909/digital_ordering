import { useTranslation } from '@dop/i18n';
import { Icon } from './Icon';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
export const PIN_MAX = 6;

/**
 * PIN entry shared by the device sign-in and the personal PIN pad: slots that fill as digits are typed (four,
 * growing to six) and a large keypad. Digits stay Western and left-to-right in both languages.
 */
export function PinPad({ pin, labelId, disabled, busy, onPress, onBack, large }: { pin: string; labelId?: string; disabled: boolean; busy: boolean; onPress: (d: string) => void; onBack: () => void; large?: boolean }) {
  const { t } = useTranslation();
  const slots = Math.min(PIN_MAX, Math.max(4, pin.length + (pin.length >= 4 && pin.length < PIN_MAX ? 1 : 0)));
  const key = `num inline-flex items-center justify-center rounded-2xl font-display font-semibold transition-[background-color,transform] duration-100 enabled:active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 ${large ? 'h-[4.5rem] text-3xl' : 'h-16 text-2xl'}`;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col items-center gap-2">
        <output
          {...(labelId ? { 'aria-labelledby': labelId } : { 'aria-label': t('signIn.pin') })}
          aria-live="polite"
          className="flex h-10 items-center justify-center gap-3"
          dir="ltr"
        >
          {Array.from({ length: slots }, (_, i) => (
            <span
              key={i}
              aria-hidden="true"
              className={`size-4 rounded-full transition-[background-color,transform] duration-150 ${i < pin.length ? 'scale-110 bg-ink' : 'border-2 border-line bg-surface'}`}
            />
          ))}
          <span className="sr-only">{pin.length === 0 ? t('signIn.pinHint') : t('signIn.digitsEntered', { n: pin.length })}</span>
        </output>
        <span className="text-sm text-muted" aria-hidden="true">
          {t('signIn.pinHint')}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2.5" dir="ltr">
        {KEYS.map((d) => (
          <button key={d} type="button" className={`${key} bg-canvas text-ink ring-1 ring-line ring-inset enabled:hover:bg-primary-wash`} disabled={busy || disabled} onClick={() => onPress(d)}>
            {d}
          </button>
        ))}
        <span />
        <button type="button" className={`${key} bg-canvas text-ink ring-1 ring-line ring-inset enabled:hover:bg-primary-wash`} disabled={busy || disabled} onClick={() => onPress('0')}>
          0
        </button>
        <button type="button" className={`${key} text-ink-2 enabled:hover:bg-canvas`} onClick={onBack} aria-label={t('signIn.delete')} disabled={busy || pin.length === 0}>
          <Icon name="backspace" className="size-7" />
        </button>
      </div>
    </div>
  );
}
