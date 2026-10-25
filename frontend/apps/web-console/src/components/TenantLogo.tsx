import { useTranslation } from '@dop/i18n';
import { Banner, LiveRegion } from '@dop/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../lib/api';
import { ErrorNote, Section } from './common';

// Restaurant logo (PNG, JPEG or WebP, up to 2 MB). The admin dashboard shows it in its sidebar.

export const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;

export function logoProblem(file: { type: string; size: number }): 'type' | 'size' | null {
  if (!LOGO_TYPES.includes(file.type)) return 'type';
  if (file.size > LOGO_MAX_BYTES) return 'size';
  return null;
}

export const uploadTenantLogo = (tenantId: string, file: File) => api.upload<{ logoUrl: string }>(`/tenants/${tenantId}/logo`, file);

const INPUT_CLASS =
  'min-h-12 rounded-input border border-dashed border-line bg-canvas p-2 text-sm file:me-3 file:min-h-10 file:cursor-pointer file:rounded-control file:border-0 file:bg-panel file:px-4 file:font-semibold file:text-white hover:border-ink-2/30';

/** File picker that checks type and size and hands a valid file to `onPick`. */
export function LogoPicker({ id, label, onPick, onProblem }: { id: string; label: string; onPick: (f: File | null) => void; onProblem?: (p: string | null) => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-semibold text-ink-2">
        {label}
      </label>
      <input
        id={id}
        type="file"
        accept={LOGO_TYPES.join(',')}
        className={INPUT_CLASS}
        onChange={(e) => {
          const file = e.target.files?.[0] ?? null;
          if (!file) return onPick(null);
          const p = logoProblem(file);
          onProblem?.(p ? t(`logo.problem.${p}`) : null);
          onPick(p ? null : file);
        }}
      />
      <p className="text-sm text-muted">{t('logo.hint')}</p>
    </div>
  );
}

/** Upload section on the tenant page. */
export function TenantLogoSection({ tenantId, logoUrl }: { tenantId: string; logoUrl: string | null }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [problem, setProblem] = useState<string | null>(null);
  const upload = useMutation({
    mutationFn: (file: File) => uploadTenantLogo(tenantId, file),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['tenant', tenantId] }),
  });
  return (
    <Section title={t('logo.title')} description={t('logo.intro')}>
      <div className="flex flex-col gap-4">
        {logoUrl && <img src={logoUrl} alt="" className="size-20 rounded-xl border border-line object-contain p-1" />}
        <LogoPicker id="tenant-logo" label={t('logo.label')} onProblem={setProblem} onPick={(f) => f && upload.mutate(f)} />
        {upload.isPending && <p role="status">{t('logo.uploading')}</p>}
        {problem && <Banner tone="danger">{problem}</Banner>}
        <ErrorNote error={upload.error} />
        <LiveRegion toast text={upload.isSuccess ? t('logo.done') : ''} />
      </div>
    </Section>
  );
}
