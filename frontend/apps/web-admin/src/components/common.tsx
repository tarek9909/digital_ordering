import { useTranslation } from '@dop/i18n';
import { Banner, Button, Card, Modal, Spinner } from '@dop/ui';
import { useId, useState, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { Link } from 'react-router';
import { errorText, isCode } from '../lib/errors';
import { useRole } from '../lib/me';

/** Error banner. Plan errors explain the limit and point owners to billing (upsell). */
export function ErrorNote({ error }: { error: unknown }) {
  const { t } = useTranslation();
  const role = useRole();
  if (!error) return null;
  const plan = isCode(error, 'FEATURE_NOT_IN_PLAN') ? 'feature' : isCode(error, 'PLAN_LIMIT') ? 'limit' : null;
  if (plan)
    return (
      <Banner
        tone="warn"
        action={
          role === 'owner' ? (
            <Link to="/billing" className="inline-flex min-h-12 items-center rounded-lg bg-surface px-4 font-semibold text-ink underline">
              {t('upsell.seePlans')}
            </Link>
          ) : undefined
        }
      >
        {t(`upsell.${plan}`)} {role !== 'owner' && t('upsell.askOwner')}
      </Banner>
    );
  return <Banner tone="danger">{errorText(t, error)}</Banner>;
}

export function Loading() {
  const { t } = useTranslation();
  return (
    <div className="grid place-items-center p-8">
      <Spinner label={t('common:loading')} />
    </div>
  );
}

/** Query state wrapper: spinner, error or content. */
export function QueryView<T>({ q, children }: { q: { isPending: boolean; error: unknown; data: T | undefined }; children: (data: T) => ReactNode }) {
  if (q.error) return <ErrorNote error={q.error} />;
  if (q.isPending || q.data === undefined) return <Loading />;
  return <>{children(q.data)}</>;
}

export function Section({ title, description, children, actions }: { title: string; description?: string; children: ReactNode; actions?: ReactNode }) {
  const id = useId();
  return (
    <Card className="mb-4" aria-labelledby={id}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id={id} className="text-lg font-bold">
            {title}
          </h2>
          {description && <p className="text-sm text-muted">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </Card>
  );
}

export function Checkbox({ label, hint, ...rest }: { label: string; hint?: string } & Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const id = useId();
  return (
    <div className="flex min-h-12 flex-wrap items-center gap-3">
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
        className={`min-h-24 rounded-lg border bg-surface p-3 text-base ${error ? 'border-danger' : 'border-line'}`}
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

/** Radio group with a fieldset legend. */
export function RadioGroup<V extends string>({ legend, name, value, options, onChange, hint }: { legend: string; name: string; value: V; options: Array<{ value: V; label: string }>; onChange: (v: V) => void; hint?: string }) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-1 font-medium">{legend}</legend>
      {options.map((o) => (
        <label key={o.value} className="flex min-h-12 cursor-pointer items-center gap-3">
          <input type="radio" name={name} className="size-5" value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
          {o.label}
        </label>
      ))}
      {hint && <p className="text-sm text-muted">{hint}</p>}
    </fieldset>
  );
}

export function Table({ caption, head, children }: { caption: string; head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-canvas">
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className="px-3 py-2 text-start font-semibold whitespace-nowrap">
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
  <td className={`border-t border-line px-3 py-2 text-start align-top ${className ?? ''}`}>{children}</td>
);

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
      <div className="text-sm text-muted">{label}</div>
      <div className="num mt-1 text-start text-3xl font-bold">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

/** Status shown as text plus a symbol, never colour alone. */
export function StatusPill({ tone, children }: { tone: 'ok' | 'warn' | 'danger' | 'info'; children: ReactNode }) {
  const tones = { ok: 'bg-[#e6f4ea] text-ok', warn: 'bg-warn-bg text-warn', danger: 'bg-danger-bg text-danger', info: 'bg-[#e8f0fe] text-[#0b3d91]' };
  const marks = { ok: '✓', warn: '▲', danger: '✕', info: '●' };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${tones[tone]}`}>
      <span aria-hidden="true">{marks[tone]}</span>
      {children}
    </span>
  );
}

/** Confirmation dialog for actions with side effects. */
export function ConfirmButton({
  label,
  title,
  description,
  confirmLabel,
  onConfirm,
  variant = 'secondary',
  busy,
}: {
  label: string;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void | Promise<unknown>;
  variant?: 'secondary' | 'danger' | 'primary';
  busy?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)} busy={busy}>
        {label}
      </Button>
      <Modal open={open} onOpenChange={setOpen} title={title} description={description}>
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            {t('common:cancel')}
          </Button>
          <Button
            variant={variant === 'danger' ? 'danger' : 'primary'}
            onClick={async () => {
              setOpen(false);
              await onConfirm();
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </Modal>
    </>
  );
}

export function CopyButton({ text, label }: { text: string; label: string }) {
  const { t } = useTranslation();
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  return (
    <>
      <Button
        variant="secondary"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setState('copied');
          } catch {
            setState('failed');
          }
          setTimeout(() => setState('idle'), 2500);
        }}
      >
        {state === 'copied' ? t('copied') : label}
      </Button>
      <span className="sr-only" role="status" aria-live="polite">
        {state === 'copied' ? t('copied') : state === 'failed' ? t('copyFailed') : ''}
      </span>
    </>
  );
}
