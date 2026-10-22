import { useTranslation } from '@dop/i18n';
import { Button } from '@dop/ui';
import { useState } from 'react';
import { publicApi } from '../lib/api';
import { clientId } from '../lib/storage';

// 1–5 stars after Collected; comment asked when 3 stars or fewer (FR-CUS-10). The review link, when the venue
// has one, is shown to every rating customer (FR-RPT-09).
export function RatingForm({ token }: { token: string }) {
  const { t } = useTranslation();
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [done, setDone] = useState<{ reviewLinkUrl: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  if (done) {
    return (
      <div className="flex flex-col items-center gap-3">
        <p className="font-semibold text-ok">{t('rating.thanks')}</p>
        {done.reviewLinkUrl && (
          <a href={done.reviewLinkUrl} target="_blank" rel="noopener noreferrer nofollow" className="underline">
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
    <fieldset className="flex w-full flex-col items-center gap-3">
      <legend className="mb-2 text-lg font-semibold">{t('rating.title')}</legend>
      <div className="flex gap-1" role="radiogroup">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            role="radio"
            aria-checked={stars === n}
            aria-label={t('rating.star', { count: n })}
            className={`min-h-12 min-w-12 text-4xl ${n <= stars ? 'text-[#f5a623]' : 'text-line'}`}
            onClick={() => setStars(n)}
          >
            ★
          </button>
        ))}
      </div>
      {stars > 0 && stars <= 3 && (
        <label className="flex w-full flex-col gap-1">
          <span>{t('rating.comment')}</span>
          <textarea className="min-h-24 rounded-lg border border-line p-3" maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} />
        </label>
      )}
      {failed && (
        <p role="alert" className="font-semibold text-danger">
          {t('rating.failed')}
        </p>
      )}
      {stars > 0 && (
        <Button busy={busy} onClick={submit}>
          {t('rating.send')}
        </Button>
      )}
    </fieldset>
  );
}
