import type { ChimeSource } from '@dop/client-sdk';
import { useTranslation } from '@dop/i18n';
import { Button } from '@dop/ui';
import { Sheet } from './Sheet';
import { useState } from 'react';
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

  return (
    <Sheet onClose={() => onClose(delivery)} title={step === 'ios' ? t('ios.title') : step === 'inapp' ? t('inApp.title') : t('activation.title')}>
      <div className="flex flex-col gap-4 text-lg">
        {step === 'intro' && (
          <>
            <p>{t('activation.step1')}</p>
            <Button size="lg" onClick={playTest}>
              🔊 {t('turnOnAlerts')}
            </Button>
          </>
        )}
        {step === 'heard' && (
          <>
            <p className="font-semibold">{t('activation.heard')}</p>
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
            <p>{t('activation.volumeTip')}</p>
            <Button size="lg" onClick={playTest}>
              {t('activation.tryAgain')}
            </Button>
          </>
        )}
        {step === 'push' && (
          <>
            <p>{t('activation.pushIntro')}</p>
            <Button size="lg" busy={busy} onClick={allow}>
              🔔 {t('activation.allow')}
            </Button>
            <Button variant="ghost" onClick={skip}>
              {t('activation.skip')}
            </Button>
          </>
        )}
        {step === 'ios' && (
          <>
            <ol className="list-decimal space-y-2 ps-6">
              <li>{t('ios.step1')} (⬆︎)</li>
              <li>{t('ios.step2')}</li>
              <li>{t('ios.step3')}</li>
            </ol>
            <Button variant="ghost" onClick={skip}>
              {t('activation.skip')}
            </Button>
          </>
        )}
        {step === 'inapp' && (
          <>
            <p>{t('inApp.body')}</p>
            <Button
              size="lg"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(location.href);
                  setCopied(true);
                } catch {
                  /* clipboard blocked: the URL bar still works */
                }
              }}
            >
              {copied ? t('inApp.copied') : t('inApp.copy')}
            </Button>
            <Button variant="ghost" onClick={() => setStep('intro')}>
              {t('activation.skip')}
            </Button>
          </>
        )}
        {step === 'blocked' && (
          <>
            <p>{t('activation.blocked')}</p>
            <Button onClick={() => onClose(delivery)}>{t('common:close')}</Button>
          </>
        )}
        {step === 'failed' && (
          <>
            <p role="alert" className="text-danger">
              {t('activation.failed')}
            </p>
            <Button size="lg" busy={busy} onClick={allow}>
              {t('activation.retry')}
            </Button>
            <Button variant="ghost" onClick={skip}>
              {t('activation.skip')}
            </Button>
          </>
        )}
        {step === 'done' && (
          <>
            <p className="font-semibold text-ok">✓ {t('activation.done')}</p>
            <Button onClick={() => onClose(delivery)}>{t('common:close')}</Button>
          </>
        )}
      </div>
    </Sheet>
  );
}
