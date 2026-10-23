import { useTranslation } from '@dop/i18n';
import { Button, LiveRegion } from '@dop/ui';
import { useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';
import { isoDate } from '../lib/format';
import { ErrorNote } from './common';

/** Owner's full data export (TR-PRV-07): the ZIP is built on the spot and downloads straight away. */
export function DataExport() {
  const { t } = useTranslation();
  const dl = useMutation({
    mutationFn: async () => {
      const blob = await api.get<Blob>('/exports/download');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tanbeeh-export-${isoDate(new Date())}.zip`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    },
  });
  return (
    <div className="flex flex-col gap-3">
      <p className="max-w-2xl text-ink-2">{t('settings.exportHint')}</p>
      <ErrorNote error={dl.error} />
      <div>
        <Button variant="secondary" busy={dl.isPending} onClick={() => dl.mutate()}>
          <span aria-hidden="true">↓</span>
          {t('settings.exportDownload')}
        </Button>
      </div>
      <LiveRegion text={dl.isSuccess ? t('settings.exportReady') : ''} />
    </div>
  );
}
