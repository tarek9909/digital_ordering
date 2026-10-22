import { Banner, Button } from '@dop/ui';
import { useTranslation } from '@dop/i18n';
import { useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { errorText } from '../lib/errors';

export function ErrorNote({ error }: { error: unknown }) {
  const { t } = useTranslation();
  if (!error) return null;
  return <Banner tone="danger">{errorText(t, error)}</Banner>;
}

export function Checkbox({ label, hint, ...rest }: { label: string; hint?: string } & Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const id = useId();
  return (
    <div className="flex min-h-12 items-center gap-3">
      <input id={id} type="checkbox" className="size-6" aria-describedby={hint ? `${id}-h` : undefined} {...rest} />
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      {hint && (
        <span id={`${id}-h`} className="text-sm text-muted">
          {hint}
        </span>
      )}
    </div>
  );
}

export function TextArea({ label, error, hint, ...rest }: { label: string; error?: string; hint?: string } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      <textarea
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-e` : hint ? `${id}-h` : undefined}
        className={`min-h-24 rounded-input border bg-surface p-3 font-mono text-sm ${error ? 'border-danger' : 'border-line'}`}
        {...rest}
      />
      {hint && !error && (
        <p id={`${id}-h`} className="text-sm text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-e`} role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export function PagerControls({ page, canPrev, nextCursor, onPrev, onNext }: { page: number; canPrev: boolean; nextCursor: string | null | undefined; onPrev: () => void; onNext: (c: string) => void }) {
  const { t } = useTranslation();
  return (
    <nav aria-label={t('pager.label')} className="mt-4 flex items-center justify-between gap-3">
      <Button variant="secondary" disabled={!canPrev} onClick={onPrev}>
        {t('pager.prev')}
      </Button>
      <span className="text-muted">{t('pager.page', { page })}</span>
      <Button variant="secondary" disabled={!nextCursor} onClick={() => nextCursor && onNext(nextCursor)}>
        {t('pager.next')}
      </Button>
    </nav>
  );
}

export function Table({ caption, head, children }: { caption: string; head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface shadow-card">
      <table className="w-full border-collapse text-sm [&_tbody_tr]:transition-colors [&_tbody_tr:hover]:bg-primary-wash">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className="eyebrow px-4 pt-4 pb-3 text-start whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export const Td = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <td className={`border-t border-line px-4 py-2.5 text-start align-middle ${className ?? ''}`}>{children}</td>
);

/** Tenant status as text plus a marker shape, never colour alone. */
export function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const tone =
    status === 'active'
      ? 'bg-ok-bg text-ok'
      : status === 'trial'
        ? 'bg-info-bg text-info'
        : status === 'past_due'
          ? 'bg-warn-bg text-warn'
          : 'bg-danger-bg text-danger';
  const mark = status === 'active' ? '●' : status === 'trial' ? '◐' : status === 'past_due' ? '▲' : '■';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap ${tone}`}>
      <span aria-hidden="true">{mark}</span>
      {t(`tenantStatus.${status}`, { defaultValue: status })}
    </span>
  );
}

/** Cancel + submit row used by dialogs. */
export function FormButtons({ onCancel, busy, label, danger }: { onCancel: () => void; busy: boolean; label: string; danger?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="flex justify-end gap-2">
      <Button type="button" variant="secondary" onClick={onCancel}>
        {t('common:cancel')}
      </Button>
      <Button type="submit" variant={danger ? 'danger' : 'primary'} busy={busy}>
        {label}
      </Button>
    </div>
  );
}
