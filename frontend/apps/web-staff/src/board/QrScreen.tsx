import { useTranslation } from '@dop/i18n';
import { BrandMark, FullScreen } from '@dop/ui';
import { Icon } from '../components/Icon';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useRef } from 'react';
import { useStaff } from '../lib/store';

interface Props {
  ticketId: string;
  number: string;
  url: string;
  /** Claim code for the venue-QR fallback (FR-TKT-07); null when claims are off. */
  claimCode: string | null;
  onClose: () => void;
}

/** Full-screen ticket QR; closes when a phone follows the ticket or on tap (FR-QR-01, FR-QR-02). */
export function QrScreen({ ticketId, number, url, claimCode, onClose }: Props) {
  const { t } = useTranslation();
  const followed = useStaff((s) => s.lastFollowed);
  const opened = useRef(followed);

  useEffect(() => {
    if (followed && followed.id === ticketId && followed !== opened.current) onClose();
  }, [followed, ticketId, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <FullScreen label={t('qr.label', { number })} className="cursor-pointer bg-surface text-ink">
      <button type="button" onClick={onClose} className="flex w-full max-w-5xl flex-col items-center gap-6 lg:flex-row lg:justify-center lg:gap-16" aria-label={t('qr.tapToClose')}>
        <span className="flex flex-col items-center gap-3 text-center lg:items-start lg:text-start">
          <span className="flex items-center gap-2.5 font-display text-xl font-bold text-ink-2 sm:text-2xl">
            <BrandMark className="size-9" />
            {t('qr.scan')}
          </span>
          <span data-motion="pop" className="num font-display text-[5.5rem] leading-[0.9] font-extrabold tracking-tight sm:text-[8rem]">
            {number}
          </span>
          {claimCode && (
            <span className="flex items-center gap-3 rounded-control bg-canvas py-2 ps-5 pe-2 text-lg text-ink-2 ring-1 ring-line ring-inset">
              {t('qr.claimCode')}
              <span className="num rounded-control bg-ink px-4 py-1 font-mono text-2xl font-medium tracking-[0.2em] text-white" dir="ltr">
                {claimCode}
              </span>
            </span>
          )}
          <span className="mt-2 hidden items-center gap-2 text-muted lg:inline-flex">
            <Icon name="close" className="size-4" />
            {t('qr.tapToClose')}
          </span>
        </span>
        <span className="rounded-[2rem] bg-surface p-4 shadow-card ring-1 ring-line">
          <QRCodeSVG value={url} size={512} level="M" marginSize={1} style={{ width: 'min(78vw, 56vh)', height: 'min(78vw, 56vh)', display: 'block' }} />
        </span>
        <span className="inline-flex items-center gap-2 text-muted lg:hidden">
          <Icon name="close" className="size-4" />
          {t('qr.tapToClose')}
        </span>
      </button>
    </FullScreen>
  );
}
