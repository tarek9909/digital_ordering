import { useTranslation } from '@dop/i18n';
import { Banner, Button, Card, Modal, Pill, Skeleton, Spinner, Stat as UiStat } from '@dop/ui';
import { useId, useState, type InputHTMLAttributes, type ReactNode, type Ref, type TextareaHTMLAttributes } from 'react';
import { Link } from 'react-router';
import { errorText, isCode } from '../lib/errors';
import { useRole, useTenant } from '../lib/me';
import { useCurrentVenueId, useVenues } from '../lib/venue';

// Local building blocks of the restaurant admin, on top of @dop/ui (brand: Ember console patterns).

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

type LinkVariant = 'primary' | 'secondary' | 'ink' | 'ghost' | 'quiet';
const LINK_VARIANTS: Record<LinkVariant, string> = {
  primary: 'bg-primary text-on-primary shadow-button hover:bg-primary-hover hover:-translate-y-px',
  ink: 'bg-ink text-white shadow-button hover:bg-ink-2 hover:-translate-y-px',
  secondary: 'border border-line bg-surface text-ink hover:border-ink-2/30 hover:bg-canvas',
  ghost: 'text-ink hover:bg-canvas',
  // On a coloured banner: a white chip.
  quiet: 'bg-surface/80 text-ink hover:bg-surface',
};

/** A link that looks like a Button (same pill, sizes and press feedback). */
export const linkClass = (variant: LinkVariant = 'secondary', className?: string) =>
  cx(
    'inline-flex min-h-12 items-center justify-center gap-2 rounded-control px-4 font-semibold whitespace-nowrap transition-[background-color,border-color,transform] duration-150 active:scale-[.98]',
    LINK_VARIANTS[variant],
    className,
  );

/** An inline text link (underline that warms on hover). */
export const textLinkClass = 'inline-flex min-h-12 items-center font-semibold text-ink underline decoration-primary/40 underline-offset-4 hover:text-primary-hover hover:decoration-primary';

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
            <Link to="/billing" className={linkClass('quiet')}>
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
    <div className="grid place-items-center p-8 text-muted">
      <Spinner label={t('common:loading')} />
    </div>
  );
}

export type SkeletonKind = 'table' | 'cards' | 'form' | 'tiles';

/** Placeholder shaped like what is about to load; announced once for screen readers. */
export function LoadingShape({ kind }: { kind: SkeletonKind }) {
  const { t } = useTranslation();
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">{t('common:loading')}</span>
      {kind === 'table' && (
        <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4">
          <Skeleton className="h-3 w-1/3" />
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      )}
      {kind === 'cards' && (
        <div className="grid gap-4 md:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className="flex flex-col gap-3 rounded-[var(--radius-card)] bg-surface p-5 shadow-card">
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-12 w-40 rounded-control" />
            </div>
          ))}
        </div>
      )}
      {kind === 'tiles' && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex flex-col gap-3 rounded-[var(--radius-card)] bg-surface p-5 shadow-card">
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-9 w-2/3" />
            </div>
          ))}
        </div>
      )}
      {kind === 'form' && (
        <div className="flex max-w-xl flex-col gap-4 rounded-[var(--radius-card)] bg-surface p-5 shadow-card">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex flex-col gap-2">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-12 w-full" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Query state wrapper: placeholder, error or content. */
export function QueryView<T>({ q, children, skeleton }: { q: { isPending: boolean; error: unknown; data: T | undefined }; children: (data: T) => ReactNode; skeleton?: SkeletonKind }) {
  if (q.error) return <ErrorNote error={q.error} />;
  if (q.isPending || q.data === undefined) return skeleton ? <LoadingShape kind={skeleton} /> : <Loading />;
  return <>{children(q.data)}</>;
}

/** A calm card with a heading: one topic of a page (a form, a list, a setting). */
export function Section({ title, description, children, actions, tone }: { title: string; description?: ReactNode; children: ReactNode; actions?: ReactNode; tone?: 'danger' }) {
  const id = useId();
  return (
    <Card className={cx('mb-5 p-5 sm:p-6', tone === 'danger' && 'ring-1 ring-danger/20')} role="region" aria-labelledby={id}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id={id} className={cx('text-lg leading-snug font-bold', tone === 'danger' && 'text-danger')}>
            {title}
          </h2>
          {description && <p className="max-w-2xl text-sm text-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </Card>
  );
}

export function Checkbox({ label, hint, ...rest }: { label: string; hint?: string } & Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const id = useId();
  return (
    <div className="flex min-h-12 items-start gap-3 py-2">
      <input id={id} type="checkbox" className="mt-0.5 size-5 shrink-0" aria-describedby={hint ? `${id}-h` : undefined} {...rest} />
      <span className="flex flex-col gap-0.5">
        <label htmlFor={id} className="font-medium">
          {label}
        </label>
        {hint && (
          <span id={`${id}-h`} className="text-sm text-muted">
            {hint}
          </span>
        )}
      </span>
    </div>
  );
}

export function TextArea({
  label,
  error,
  hint,
  ...rest
}: {
  label: string;
  error?: string;
  hint?: string;
} & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold text-ink-2">
        {label}
      </label>
      <textarea
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-e` : hint ? `${id}-h` : undefined}
        className={cx('min-h-24 rounded-input border bg-surface p-3.5 text-base hover:border-ink-2/30', error ? 'border-danger' : 'border-line')}
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

/** Radio group with a fieldset legend; each choice is a full-width row, the chosen one outlined in ink. */
export function RadioGroup<V extends string>({
  legend,
  name,
  value,
  options,
  onChange,
  hint,
}: {
  legend: string;
  name: string;
  value: V;
  options: Array<{ value: V; label: string }>;
  onChange: (v: V) => void;
  hint?: string;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-semibold text-ink-2">{legend}</legend>
      {options.map((o) => (
        <label
          key={o.value}
          className="flex min-h-12 cursor-pointer items-center gap-3 rounded-input border border-line bg-surface px-3.5 transition-colors hover:border-ink-2/30 has-checked:border-ink has-checked:bg-canvas"
        >
          <input type="radio" name={name} className="size-5" value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
          <span className="font-medium">{o.label}</span>
        </label>
      ))}
      {hint && <p className="text-sm text-muted">{hint}</p>}
    </fieldset>
  );
}

/**
 * Data table (console pattern): eyebrow column heads, warm row hover, numbers in tabular figures. `raised` floats it
 * on the page; inside a Section it sits flat.
 */
export function Table({ caption, head, children, raised, bodyRef }: { caption: string; head: string[]; children: ReactNode; raised?: boolean; bodyRef?: Ref<HTMLTableSectionElement> }) {
  return (
    <div className={cx('overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface', raised && 'shadow-card')}>
      <table className="w-full border-collapse text-sm [&_tbody_tr]:transition-colors [&_tbody_tr:hover]:bg-primary-wash">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={`${h}-${i}`} scope="col" className="eyebrow px-4 pt-4 pb-3 text-start whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody ref={bodyRef}>{children}</tbody>
      </table>
    </div>
  );
}

export const Td = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <td className={cx('border-t border-line px-4 py-2.5 align-middle', !className?.includes('text-end') && 'text-start', className)}>{children}</td>
);

/** Big figure (counts up once) with an eyebrow label. */
export function Stat({ label, value, hint, accent, className }: { label: string; value: ReactNode; hint?: ReactNode; accent?: boolean; className?: string }) {
  return <UiStat label={label} value={value} hint={hint} accent={accent} className={className} />;
}

/** Status shown as text plus a marker shape, never colour alone. */
export function StatusPill({ tone, children }: { tone: 'ok' | 'warn' | 'danger' | 'info' | 'neutral' | 'ink'; children: ReactNode }) {
  return <Pill tone={tone}>{children}</Pill>;
}

/** Confirmation dialog for actions with side effects. A dangerous trigger stays quiet; the dialog carries the red. */
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
  variant?: 'secondary' | 'danger' | 'primary' | 'ink';
  busy?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const danger = variant === 'danger';
  return (
    <>
      <Button
        variant={danger ? 'secondary' : variant}
        className={danger ? 'whitespace-nowrap text-danger! hover:border-danger/40 hover:bg-danger-bg!' : 'whitespace-nowrap'}
        onClick={() => setOpen(true)}
        busy={busy}
      >
        {label}
      </Button>
      <Modal open={open} onOpenChange={setOpen} title={title} description={description}>
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            {t('common:cancel')}
          </Button>
          <Button
            variant={danger ? 'danger' : variant === 'secondary' ? 'ink' : variant}
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

export function CopyButton({ text, label, variant = 'secondary' }: { text: string; label: string; variant?: 'secondary' | 'primary' | 'ink' }) {
  const { t } = useTranslation();
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  return (
    <>
      <Button
        variant={variant}
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
        {state === 'copied' && (
          <span aria-hidden="true" data-motion="pop">
            ✓
          </span>
        )}
        {state === 'copied' ? t('copied') : label}
      </Button>
      <span className="sr-only" role="status" aria-live="polite">
        {state === 'copied' ? t('copied') : state === 'failed' ? t('copyFailed') : ''}
      </span>
    </>
  );
}

/** Segmented tabs (ink pill on the chosen one). The caller renders the matching role="tabpanel". */
export function Tabs<K extends string>({
  label,
  tabs,
  value,
  onChange,
  idPrefix,
  labelOf,
}: {
  label: string;
  tabs: readonly K[];
  value: K;
  onChange: (k: K) => void;
  idPrefix: string;
  labelOf: (k: K) => string;
}) {
  return (
    <div className="mb-5 overflow-x-auto">
      <div role="tablist" aria-label={label} className="inline-flex gap-1 rounded-control border border-line bg-surface p-1">
        {tabs.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            id={`${idPrefix}tab-${k}`}
            aria-selected={value === k}
            aria-controls={`${idPrefix}panel-${k}`}
            onClick={() => onChange(k)}
            className={cx(
              'min-h-12 rounded-control px-5 font-semibold whitespace-nowrap transition-colors',
              value === k ? 'bg-ink text-white shadow-button' : 'text-ink-2 hover:bg-canvas hover:text-ink',
            )}
          >
            {labelOf(k)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Page context line: the venue a page manages, or the restaurant for account-wide pages. */
export function usePageEyebrow(scope: 'venue' | 'tenant'): string | undefined {
  const venues = useVenues(scope === 'venue').data ?? [];
  const venueId = useCurrentVenueId(scope === 'venue');
  const tenant = useTenant().data;
  if (scope === 'venue') return venues.find((v) => v.id === venueId)?.name ?? tenant?.name;
  return tenant?.name;
}
