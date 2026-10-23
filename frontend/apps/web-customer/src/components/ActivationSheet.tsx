import type { ChimeSource } from '@dop/client-sdk';
import { useTranslation } from '@dop/i18n';
import { Button } from '@dop/ui';
import { Sheet } from './Sheet';
import { useState, type ReactNode } from 'react';
import { AlertIcon, BellIcon, CheckIcon, LinkIcon, QuestionIcon, ShareIcon, SoundIcon } from './icons';
import { publicApi } from '../lib/api';
import { keepAwake, testChime, unlockAudio } from '../lib/audio';
import { inAppBrowser, isIOS, isStandalone, pushSupported } from '../lib/platform';
import { enablePush, notificationsBlocked } from '../lib/push';
import { clientId } from '../lib/storage';

// "Turn on alerts" flow (TRD §11.2, FR-ALR-01/02, TR-ALR-03 – TR-ALR-05): test chime → "Did you hear that?" →
// wake lock → notification permission, or the iOS Home Screen guide, or the in-app browser warning.

type Step = 'intro' | 'heard' | 'volume' | 'push' | 'ios' | 'inapp' | 'blocked' | 'failed' | 'done';

/**
 * What this ticket can actually alert through (CSD01, FR-ALR-01/03/05):
 * - `push`: the browser subscription was saved for this ticket's follower (background alerts work);
 * - `live`: sound/vibration while the page stays open, no background push (unsupported, or no push configured);
 * - `blocked`: the customer or browser refused notifications;
 * - `failed`: setting up push failed operationally (config, worker, subscribe or saving it) — offer a retry;
 * - `none`: nothing changed (the customer skipped before any attempt).
 */
export type AlertDelivery = 'none' | 'live' | 'push' | 'blocked' | 'failed';

export function ActivationSheet({
  token,
  chime,
  fromHomeScreen,
  ensureFollowed,
  leaving,
  onClose,
}: {
  token: string;
  /** The venue's chime, so the test sound is the one the alert will use (W11). */
  chime?: ChimeSource;
  fromHomeScreen: boolean;
  /**
   * Resolves true once this phone follows the ticket. Saving a push subscription needs the follower row, so the
   * sheet waits for it instead of racing the page's own registration (CSD01).
   */
  ensureFollowed?: () => Promise<boolean>;
  /** The sheet is closing (its slide-away plays while the page unmounts it). */
  leaving?: boolean;
  /** Reports the delivery capability actually reached; never `push` unless the subscription was saved. */
  onClose: (delivery: AlertDelivery) => void;
}) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>(fromHomeScreen ? 'push' : inAppBrowser() ? 'inapp' : 'intro');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  // The capability the sheet has established so far; reported on every close.
  const [delivery, setDelivery] = useState<AlertDelivery>('none');

  const recordEnabled = () => publicApi.post(`/tickets/${token}/alerts-enabled`, { clientId: clientId() }).catch(() => undefined);

  const playTest = async () => {
    await unlockAudio();
    await testChime(chime);
    setStep('heard');
  };

  const afterHeard = async () => {
    await keepAwake();
    if (pushSupported() && !notificationsBlocked()) return setStep('push');
    if (notificationsBlocked()) return setStep('blocked');
    if (isIOS() && !isStandalone()) return setStep('ios');
    await recordEnabled();
    setDelivery('live');
    setStep('done');
  };

  const allow = async () => {
    setBusy(true);
    await unlockAudio();
    // A setup error (follow, config, worker, subscribe or saving the subscription) is not "unsupported": the ticket
    // has no background alerts, so say so and offer a retry instead of reporting success (CSD01).
    const followed = ensureFollowed ? await ensureFollowed().catch(() => false) : true;
    const r = followed ? await enablePush(token).catch(() => 'failed' as const) : ('failed' as const);
    if (r === 'failed') {
      setBusy(false);
      setDelivery('failed');
      return setStep('failed');
    }
    await recordEnabled();
    setBusy(false);
    if (r === 'granted') {
      setDelivery('push');
      setStep('done');
      setTimeout(() => onClose('push'), 1500);
    } else if (r === 'denied') {
      setDelivery('blocked');
      setStep('blocked');
    } else {
      // No push in this browser (or none configured): alerts work only while the page is open.
      setDelivery('live');
      setStep('done');
    }
  };

  const skip = async () => {
    await recordEnabled();
    // Skipping after a failed attempt keeps the failure visible on the page, with its retry.
    onClose(delivery === 'failed' ? 'failed' : 'none');
  };

  const stage = step === 'done' ? 3 : step === 'intro' || step === 'heard' || step === 'volume' ? 1 : 2;
  const title = step === 'ios' ? t('ios.title') : step === 'inapp' ? t('inApp.title') : t('activation.title');
  return (
    <Sheet onClose={() => onClose(delivery)} leaving={leaving} title={title}>
      {/* Where the customer is in the flow: sound check, notifications, done. */}
      <div aria-hidden="true" className="mt-1 mb-5 flex gap-1.5">
        {[1, 2, 3].map((n) => (
          <span key={n} className={`h-1 flex-1 rounded-full transition-colors duration-500 ${n <= stage ? 'bg-primary' : 'bg-line'}`} />
        ))}
      </div>
      {/* Keyed by step: each step arrives in place of the last one. */}
      <div key={step} className="step-in flex flex-col gap-4 text-lg">
        {step === 'intro' && (
          <>
            <StepArt>
              <SoundIcon className="size-8" />
            </StepArt>
            <p className="text-center text-ink-2">{t('activation.step1')}</p>
            <Button size="lg" className="w-full" onClick={playTest}>
              <SoundIcon className="size-6" />
              {t('activation.play')}
            </Button>
          </>
        )}
        {step === 'heard' && (
          <>
            <StepArt>
              <QuestionIcon className="size-8" />
            </StepArt>
            <p className="text-center font-display text-xl font-bold">{t('activation.heard')}</p>
            <div className="grid grid-cols-2 gap-3">
              <Button size="lg" onClick={afterHeard}>
                {t('activation.yes')}
              </Button>
              <Button size="lg" variant="secondary" onClick={() => setStep('volume')}>
                {t('activation.no')}
              </Button>
            </div>
          </>
        )}
        {step === 'volume' && (
          <>
            <StepArt>
              <SoundIcon className="size-8" />
            </StepArt>
            <p className="text-center text-ink-2">{t('activation.volumeTip')}</p>
            <Button size="lg" className="w-full" onClick={playTest}>
              {t('activation.tryAgain')}
            </Button>
          </>
        )}
        {step === 'push' && (
          <>
            <StepArt>
              <BellIcon className="size-8" />
            </StepArt>
            <p className="text-center text-ink-2">{t('activation.pushIntro')}</p>
            <Button size="lg" className="w-full" busy={busy} onClick={allow}>
              {!busy && <BellIcon className="size-6" />}
              {t('activation.allow')}
            </Button>
            <Button variant="ghost" className="w-full text-muted" onClick={skip}>
              {t('activation.skip')}
            </Button>
          </>
        )}
        {step === 'ios' && (
          <>
            <ol className="flex flex-col gap-3">
              {[t('ios.step1'), t('ios.step2'), t('ios.step3')].map((text, i) => (
                <li key={i} className="flex items-center gap-3 rounded-input bg-canvas p-3">
                  <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-primary font-display text-base font-bold text-on-primary">
                    {i + 1}
                  </span>
                  <span className="flex-1">{text}</span>
                  {i === 0 && <ShareIcon className="size-6 shrink-0 text-muted" />}
                </li>
              ))}
            </ol>
            <Button variant="ghost" className="w-full text-muted" onClick={skip}>
              {t('activation.skip')}
            </Button>
          </>
        )}
        {step === 'inapp' && (
          <>
            <StepArt>
              <LinkIcon className="size-8" />
            </StepArt>
            <p className="text-center text-ink-2">{t('inApp.body')}</p>
            <Button
              size="lg"
              className="w-full"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(location.href);
                  setCopied(true);
                } catch {
                  /* clipboard blocked: the URL bar still works */
                }
              }}
            >
              {copied ? <CheckIcon className="size-6" /> : <LinkIcon className="size-6" />}
              {copied ? t('inApp.copied') : t('inApp.copy')}
            </Button>
            <Button variant="ghost" className="w-full text-muted" onClick={() => setStep('intro')}>
              {t('activation.skip')}
            </Button>
          </>
        )}
        {step === 'blocked' && (
          <>
            <StepArt tone="warn">
              <AlertIcon className="size-8" />
            </StepArt>
            <p className="text-center text-ink-2">{t('activation.blocked')}</p>
            <Button size="lg" variant="secondary" className="w-full" onClick={() => onClose(delivery)}>
              {t('common:close')}
            </Button>
          </>
        )}
        {step === 'failed' && (
          <>
            <StepArt tone="danger">
              <AlertIcon className="size-8" />
            </StepArt>
            <p role="alert" className="text-center text-danger">
              {t('activation.failed')}
            </p>
            <Button size="lg" className="w-full" busy={busy} onClick={allow}>
              {t('activation.retry')}
            </Button>
            <Button variant="ghost" className="w-full text-muted" onClick={skip}>
              {t('activation.skip')}
            </Button>
          </>
        )}
        {step === 'done' && (
          <>
            <StepArt tone="ok">
              <CheckIcon className="size-8" />
            </StepArt>
            <p className="text-center font-display text-xl font-bold">{t('activation.done')}</p>
            <Button size="lg" variant="secondary" className="w-full" onClick={() => onClose(delivery)}>
              {t('common:close')}
            </Button>
          </>
        )}
      </div>
    </Sheet>
  );
}

/** The step's picture: an icon in a soft disc, venue-tinted unless the step reports a problem or success. */
function StepArt({ children, tone }: { children: ReactNode; tone?: 'ok' | 'warn' | 'danger' }) {
  const tones = { ok: 'bg-ok-bg text-ok', warn: 'bg-warn-bg text-warn', danger: 'bg-danger-bg text-danger' };
  return (
    <span aria-hidden="true" className={`mx-auto grid size-18 place-items-center rounded-full ${tone ? tones[tone] : 'bg-primary-soft text-primary'}`}>
      {children}
    </span>
  );
}
