import { Banner, Button, Pill, Skeleton } from '@dop/ui';
import { useTranslation } from '@dop/i18n';
import { useId, useState, type InputHTMLAttributes, type KeyboardEvent, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { errorText } from '../lib/errors';

/** On/off switch: a checkbox with role="switch", the label and hint before it. Checked is ink, not ember. */
export function Toggle({ label, hint, className, ...rest }: { label: string; hint?: ReactNode; className?: string } & Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const id = useId();
  return (
    <div className={`flex min-h-12 items-center justify-between gap-4 ${className ?? ''}`}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <label htmlFor={id} className="cursor-pointer font-semibold">
          {label}
        </label>
        {hint && (
          <span id={`${id}-h`} className="text-sm text-muted">
            {hint}
          </span>
        )}
      </div>
      <span className="relative inline-flex h-7 w-12 shrink-0">
        <input id={id} type="checkbox" role="switch" className="peer absolute inset-0 z-10 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed" aria-describedby={hint ? `${id}-h` : undefined} {...rest} />
        <span aria-hidden="true" className="absolute inset-0 rounded-full bg-line transition-colors peer-checked:bg-ink peer-focus-visible:ring-2 peer-focus-visible:ring-primary peer-focus-visible:ring-offset-2 peer-disabled:opacity-50" />
        <span aria-hidden="true" className="pointer-events-none absolute start-1 top-1 size-5 rounded-full bg-white shadow-button transition-transform peer-checked:translate-x-5 rtl:peer-checked:-translate-x-5" />
      </span>
    </div>
  );
}

/** One choice out of a few, as a pill bar of radio buttons. */
export function Segmented<T extends string>({ label, value, options, onChange, hideLabel, disabled }: { label: string; value: T; options: Array<{ value: T; label: ReactNode }>; onChange: (v: T) => void; hideLabel?: boolean; disabled?: boolean }) {
  const name = useId();
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5" disabled={disabled}>
      <legend className={hideLabel ? 'sr-only' : 'mb-1.5 text-sm font-semibold text-ink-2'}>{label}</legend>
      <div className="inline-flex max-w-full flex-wrap gap-1 self-start rounded-input bg-canvas p-1 ring-1 ring-line">
        {options.map((o) => {
          const on = value === o.value;
          return (
            <label
              key={o.value}
              className={`inline-flex min-h-11 cursor-pointer items-center rounded-[10px] px-3.5 text-sm font-semibold transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary ${on ? 'bg-surface text-ink shadow-card' : 'text-ink-2 hover:text-ink'}`}
            >
              <input type="radio" name={name} className="sr-only" checked={on} onChange={() => onChange(o.value)} />
              {o.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export interface TabItem<T extends string> {
  value: T;
  label: ReactNode;
  count?: number;
}

/** Tab bar (ink pill on the active tab). Arrow keys move between tabs; panels use `tabPanelProps`. */
export function Tabs<T extends string>({ label, tabs, value, onChange, id }: { label: string; tabs: TabItem<T>[]; value: T; onChange: (v: T) => void; id: string }) {
  const onKey = (e: KeyboardEvent, i: number) => {
    const dir = document.documentElement.dir === 'rtl' ? -1 : 1;
    const step = e.key === 'ArrowRight' ? dir : e.key === 'ArrowLeft' ? -dir : 0;
    if (!step) return;
    const next = tabs[(i + step + tabs.length) % tabs.length]!.value;
    onChange(next);
    document.getElementById(`${id}-tab-${next}`)?.focus();
  };
  return (
    <div role="tablist" aria-label={label} className="mb-6 flex max-w-full gap-1 self-start overflow-x-auto rounded-control bg-surface p-1 shadow-card">
      {tabs.map((x, i) => {
        const on = x.value === value;
        return (
          <button
            key={x.value}
            id={`${id}-tab-${x.value}`}
            type="button"
            role="tab"
            aria-selected={on}
            aria-controls={`${id}-panel-${x.value}`}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(x.value)}
            onKeyDown={(e) => onKey(e, i)}
            className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-control px-4 text-sm font-semibold whitespace-nowrap transition-colors ${on ? 'bg-ink text-white' : 'text-ink-2 hover:bg-canvas hover:text-ink'}`}
          >
            {x.label}
            {x.count !== undefined && <span className={`num rounded-full px-2 text-xs ${on ? 'bg-white/15' : 'bg-canvas'}`}>{x.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export const tabPanelProps = (id: string, value: string) => ({ role: 'tabpanel' as const, id: `${id}-panel-${value}`, 'aria-labelledby': `${id}-tab-${value}` });

/** A titled card: heading, a line saying what it is for, optional actions, then the content. */
export function Section({ title, description, actions, children, className, id }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  const auto = useId();
  const hid = id ?? auto;
  return (
    <section aria-labelledby={hid} className={`rounded-[var(--radius-card)] bg-surface shadow-card ${className ?? ''}`}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id={hid} className="text-lg font-bold">
            {title}
          </h2>
          {description && <p className="max-w-2xl text-sm text-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

/** Initials in a round tile, for people and restaurants in lists. */
export function Initials({ name, tone = 'ink' }: { name: string; tone?: 'ink' | 'soft' }) {
  return (
    <span aria-hidden="true" className={`grid size-9 shrink-0 place-items-center rounded-full font-display text-sm font-bold ${tone === 'ink' ? 'bg-ink text-white' : 'bg-canvas text-ink-2 ring-1 ring-line'}`}>
      {initialsOf(name) || '•'}
    </span>
  );
}

/** An action in a list: what it does on the start side, its button on the end side. */
export function ActionRow({ hint, children }: { hint: ReactNode; children: ReactNode }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <p className="min-w-0 flex-1 basis-56 text-sm text-ink-2">{hint}</p>
      {children}
    </li>
  );
}

/** Label and value rows in a card. */
export function InfoRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:items-center sm:gap-4">
      <dt className="w-44 shrink-0 text-sm text-muted">{label}</dt>
      <dd className="min-w-0 font-medium break-words">{children}</dd>
    </div>
  );
}

/**
 * A list of short values (codes, addresses, numbers) as removable chips with an input to add one. `parse` turns the
 * typed text into a value or returns an error message.
 */
export function ListField<T extends string | number>({
  label,
  hint,
  values,
  onChange,
  parse,
  format = String,
  placeholder,
  inputMode,
  max,
}: {
  label: string;
  hint?: string;
  values: T[];
  onChange: (v: T[]) => void;
  parse: (text: string) => { ok: true; value: T } | { ok: false; error: string };
  format?: (v: T) => string;
  placeholder?: string;
  inputMode?: InputHTMLAttributes<HTMLInputElement>['inputMode'];
  max?: number;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const add = () => {
    if (!text.trim()) return;
    const r = parse(text.trim());
    if (!r.ok) return setError(r.error);
    if (values.includes(r.value)) return setError(t('list.duplicate'));
    setError('');
    setText('');
    onChange([...values, r.value]);
  };
  const full = max !== undefined && values.length >= max;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold text-ink-2">
        {label}
      </label>
      <div className="flex flex-wrap items-center gap-1.5 rounded-input border border-line bg-surface p-1.5 focus-within:border-ink-2/40">
        {values.map((v, i) => (
          <span key={`${String(v)}-${i}`} className="inline-flex max-w-full items-center gap-1 rounded-full bg-canvas py-1 ps-3 pe-1 text-sm font-semibold ring-1 ring-line">
            <span dir="ltr" className="min-w-0 break-all">
              {format(v)}
            </span>
            <button type="button" className="grid size-7 shrink-0 place-items-center rounded-full text-muted hover:bg-line hover:text-ink" aria-label={t('list.remove', { item: format(v) })} onClick={() => onChange(values.filter((_, j) => j !== i))}>
              <span aria-hidden="true">×</span>
            </button>
          </span>
        ))}
        {!full && (
          <input
            id={id}
            dir="ltr"
            className="min-h-10 min-w-32 flex-1 bg-transparent px-2 text-base outline-none placeholder:text-muted/70"
            value={text}
            placeholder={placeholder}
            inputMode={inputMode}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-e` : hint ? `${id}-h` : undefined}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                add();
              }
            }}
            onBlur={add}
          />
        )}
      </div>
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

/** Class for a link styled as the main button. */
export const primaryLinkClass =
  'inline-flex min-h-12 items-center gap-2 rounded-control bg-primary px-5 font-semibold text-on-primary shadow-button transition-[background-color,transform] duration-150 hover:-translate-y-px hover:bg-primary-hover active:scale-[.98]';

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

export function Table({ caption, head, children, className }: { caption: string; head: string[]; children: ReactNode; className?: string }) {
  return (
    <div className={`overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface shadow-card ${className ?? ''}`}>
      <table className="w-full border-collapse text-sm [&_tbody_tr]:transition-colors [&_tbody_tr:hover]:bg-primary-wash">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i} scope="col" className="eyebrow px-4 pt-4 pb-3 text-start whitespace-nowrap">
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
  const tone = status === 'active' ? 'ok' : status === 'trial' ? 'info' : status === 'past_due' ? 'warn' : 'danger';
  return <Pill tone={tone}>{t(`tenantStatus.${status}`, { defaultValue: status })}</Pill>;
}

/** Placeholder rows while a table loads (no motion beyond the shared shimmer). */
export function TableSkeleton({ label, rows = 6 }: { label: string; rows?: number }) {
  return (
    <div role="status" className="flex flex-col gap-3 rounded-[var(--radius-card)] bg-surface p-5 shadow-card">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-3 w-1/3" />
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}

/** Cancel + submit row used by dialogs. */
export function FormButtons({ onCancel, busy, label, danger }: { onCancel: () => void; busy: boolean; label: string; danger?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Button type="button" variant="secondary" onClick={onCancel}>
        {t('common:cancel')}
      </Button>
      <Button type="submit" variant={danger ? 'danger' : 'primary'} busy={busy}>
        {label}
      </Button>
    </div>
  );
}
