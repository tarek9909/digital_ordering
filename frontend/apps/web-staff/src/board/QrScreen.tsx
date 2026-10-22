import { useTranslation } from '@dop/i18n';
import { FullScreen } from '@dop/ui';
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
    <FullScreen label={t('qr.label', { number })} className="cursor-pointer gap-4 bg-white text-ink">
      <button type="button" onClick={onClose} className="flex flex-col items-center gap-4" aria-label={t('qr.tapToClose')}>
        <span className="text-2xl font-semibold">{t('qr.scan')}</span>
        <span className="num text-6xl font-black">{number}</span>
        {claimCode && (
          <span className="text-xl">
            {t('qr.claimCode')}:{' '}
            <span className="num text-3xl font-black tracking-widest" dir="ltr">
              {claimCode}
            </span>
          </span>
        )}
        <QRCodeSVG value={url} size={512} level="M" marginSize={2} style={{ width: 'min(85vw, 60vh)', height: 'min(85vw, 60vh)' }} />
        <span className="text-lg text-muted">{t('qr.tapToClose')}</span>
      </button>
    </FullScreen>
  );
}
