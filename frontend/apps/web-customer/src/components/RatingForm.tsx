import { useTranslation } from '@dop/i18n';
import { Button } from '@dop/ui';
import { useState } from 'react';
import { publicApi } from '../lib/api';
import { clientId } from '../lib/storage';
import { CheckIcon, StarIcon } from './icons';

// 1–5 stars after Collected; comment asked when 3 stars or fewer (FR-CUS-10). The review link, when the venue
// has one, is shown to every rating customer (FR-RPT-09). Stars take the venue's colour.
export function RatingForm({ token }: { token: string }) {
  const { t } = useTranslation();
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [done, setDone] = useState<{ reviewLinkUrl: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  if (done) {
    return (
      <div className="step-in flex flex-col items-center gap-3 py-2">
        <span aria-hidden="true" className="grid size-12 place-items-center rounded-full bg-ok-bg text-ok">
          <CheckIcon className="size-6" />
        </span>
        <p className="font-display text-lg font-bold">{t('rating.thanks')}</p>
        {done.reviewLinkUrl && (
          <a
            href={done.reviewLinkUrl}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="inline-flex min-h-12 items-center rounded-control px-5 font-semibold ring-1 ring-line hover:bg-canvas"
          >
            {t('rating.review')}
          </a>
        )}
      </div>
    );
  }
  const submit = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const r = await publicApi.post<{ reviewLinkUrl: string | null } | undefined>(`/tickets/${token}/rating`, {
        clientId: clientId(),
        stars,
        ...(comment.trim() && { comment: comment.trim() }),
      });
      setDone({ reviewLinkUrl: r?.reviewLinkUrl ?? null });
    } catch {
      // Not saved (HTTP error or offline): keep the stars and comment so the customer can send again.
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <fieldset className="flex w-full flex-col items-center gap-4">
      <legend className="mb-3 w-full text-center font-display text-xl font-bold">{t('rating.title')}</legend>
      <div className="flex gap-1" role="radiogroup">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            role="radio"
            aria-checked={stars === n}
            aria-label={t('rating.star', { count: n })}
            className="grid size-14 place-items-center rounded-full transition-colors hover:bg-canvas"
            style={{ color: n <= stars ? 'var(--brand-band)' : 'color-mix(in srgb, var(--color-muted) 45%, transparent)' }}
            onClick={() => setStars(n)}
          >
            <span key={n <= stars ? `on-${stars}` : 'off'} className={n <= stars ? 'star-pop block' : 'block'} style={{ animationDelay: `${(n - 1) * 40}ms` }}>
              <StarIcon className="size-10" filled={n <= stars} />
            </span>
          </button>
        ))}
      </div>
      {stars > 0 && stars <= 3 && (
        <label className="step-in flex w-full flex-col gap-1.5 text-start">
          <span className="text-sm font-semibold text-ink-2">{t('rating.comment')}</span>
          <textarea className="min-h-24 rounded-input border border-line bg-surface p-3 text-base" maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} />
        </label>
      )}
      {failed && (
        <p role="alert" className="font-semibold text-danger">
          {t('rating.failed')}
        </p>
      )}
      {stars > 0 && (
        <Button size="lg" className="step-in w-full" busy={busy} onClick={submit}>
          {t('rating.send')}
        </Button>
      )}
    </fieldset>
  );
}
