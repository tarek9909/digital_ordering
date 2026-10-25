import { Banner, Button, Pill, Skeleton } from '@dop/ui';
import { useTranslation } from '@dop/i18n';
import { useId, useState, type InputHTMLAttributes, type KeyboardEvent, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { errorText } from '../lib/errors';

/** On/off switch: modern tactile switch with role="switch". Checked is ink, not ember. */
export function Toggle({ label, hint, className, ...rest }: { label: string; hint?: ReactNode; className?: string } & Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const id = useId();
  return (
    <div className={`flex min-h-12 items-center justify-between gap-4 py-1 ${className ?? ''}`}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <label htmlFor={id} className="cursor-pointer font-semibold text-ink text-sm sm:text-base">
          {label}
        </label>
        {hint && (
          <span id={`${id}-h`} className="text-xs sm:text-sm text-muted">
            {hint}
          </span>
        )}
      </div>
      <span className="relative inline-flex h-7 w-12 shrink-0">
        <input
          id={id}
          type="checkbox"
          role="switch"
          className="peer absolute inset-0 z-10 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
          aria-describedby={hint ? `${id}-h` : undefined}
          {...rest}
        />
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-full bg-line ring-1 ring-black/5 transition-colors duration-200 peer-checked:bg-ink peer-focus-visible:ring-2 peer-focus-visible:ring-primary peer-focus-visible:ring-offset-2 peer-disabled:opacity-50"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute start-1 top-1 size-5 rounded-full bg-white shadow-button transition-transform duration-200 peer-checked:translate-x-5 rtl:peer-checked:-translate-x-5"
        />
      </span>
    </div>
  );
}

/** One choice out of a few, as a modern segmented pill bar of radio buttons. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  hideLabel,
  disabled,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: ReactNode }>;
  onChange: (v: T) => void;
  hideLabel?: boolean;
  disabled?: boolean;
}) {
  const name = useId();
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5" disabled={disabled}>
      <legend className={hideLabel ? 'sr-only' : 'mb-1.5 text-xs font-bold uppercase tracking-wider text-muted'}>{label}</legend>
      <div className="inline-flex max-w-full flex-wrap gap-1 self-start rounded-xl bg-canvas p-1 ring-1 ring-line">
        {options.map((o) => {
          const on = value === o.value;
          return (
            <label
              key={o.value}
              className={`inline-flex min-h-10 cursor-pointer items-center rounded-lg px-3.5 text-xs sm:text-sm font-semibold transition-all duration-150 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary ${
                on ? 'bg-surface text-ink shadow-sm ring-1 ring-black/5' : 'text-ink-2 hover:bg-surface/50 hover:text-ink'
              }`}
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
  icon?: ReactNode;
}

/** Tab bar (ink pill on the active tab). Arrow keys move between tabs; panels use `tabPanelProps`. */
export function Tabs<T extends string>({
  label,
  tabs,
  value,
  onChange,
  id,
}: {
  label: string;
  tabs: TabItem<T>[];
  value: T;
  onChange: (v: T) => void;
  id: string;
}) {
  const onKey = (e: KeyboardEvent, i: number) => {
    const dir = document.documentElement.dir === 'rtl' ? -1 : 1;
    const step = e.key === 'ArrowRight' ? dir : e.key === 'ArrowLeft' ? -dir : 0;
    if (!step) return;
    const next = tabs[(i + step + tabs.length) % tabs.length]!.value;
    onChange(next);
    document.getElementById(`${id}-tab-${next}`)?.focus();
  };
  return (
    <div
      role="tablist"
      aria-label={label}
      className="mb-6 flex max-w-full gap-1.5 self-start overflow-x-auto rounded-2xl bg-surface p-1.5 shadow-card ring-1 ring-line custom-scrollbar"
    >
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
            className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-4 text-sm font-semibold whitespace-nowrap transition-all duration-150 ${
              on ? 'bg-ink text-white shadow-button' : 'text-ink-2 hover:bg-canvas hover:text-ink'
            }`}
          >
            {x.icon && <span className="size-4 shrink-0 opacity-80">{x.icon}</span>}
            {x.label}
            {x.count !== undefined && (
              <span className={`num rounded-full px-2 py-0.5 text-xs font-mono font-medium ${on ? 'bg-white/20 text-white' : 'bg-canvas text-ink-2'}`}>
                {x.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export const tabPanelProps = (id: string, value: string) => ({
  role: 'tabpanel' as const,
  id: `${id}-panel-${value}`,
  'aria-labelledby': `${id}-tab-${value}`,
});

/** A titled card: heading, description, optional actions, then content. */
export function Section({
  title,
  description,
  actions,
  children,
  className,
  id,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  const auto = useId();
  const hid = id ?? auto;
  return (
    <section aria-labelledby={hid} className={`console-card overflow-hidden ${className ?? ''}`}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line/80 bg-canvas/40 px-5 py-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id={hid} className="font-display text-lg font-bold tracking-tight text-ink">
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
    <span
      aria-hidden="true"
      className={`grid size-9 shrink-0 place-items-center rounded-full font-display text-xs sm:text-sm font-bold shadow-sm ${
        tone === 'ink'
          ? 'bg-gradient-to-br from-ink to-panel-2 text-white'
          : 'bg-gradient-to-br from-canvas to-surface text-ink-2 ring-1 ring-line'
      }`}
    >
      {initialsOf(name) || '•'}
    </span>
  );
}

/** An action in a list: what it does on the start side, its button on the end side. */
export function ActionRow({ hint, children }: { hint: ReactNode; children: ReactNode }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3.5 transition-colors first:pt-0 last:pb-0 hover:bg-canvas/30 rounded-lg px-2 -mx-2">
      <p className="min-w-0 flex-1 basis-56 text-sm text-ink-2">{hint}</p>
      <div className="shrink-0">{children}</div>
    </li>
  );
}

/** Label and value rows in a card. */
export function InfoRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:items-center sm:gap-4 border-b border-line/40 last:border-b-0">
      <dt className="w-44 shrink-0 text-xs sm:text-sm font-medium text-muted">{label}</dt>
      <dd className="min-w-0 font-medium text-ink break-words text-sm sm:text-base">{children}</dd>
    </div>
  );
}

/**
 * A list of short values as removable chips with an input to add one.
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
      <div className="flex flex-wrap items-center gap-1.5 rounded-input border border-line bg-surface p-1.5 transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
        {values.map((v, i) => (
          <span
            key={`${String(v)}-${i}`}
            className="inline-flex max-w-full items-center gap-1.5 rounded-lg bg-canvas py-1 ps-2.5 pe-1 text-xs font-semibold ring-1 ring-line text-ink"
          >
            <span dir="ltr" className="min-w-0 font-mono break-all">
              {format(v)}
            </span>
            <button
              type="button"
              className="grid size-5 shrink-0 place-items-center rounded-md text-muted hover:bg-line hover:text-ink transition-colors"
              aria-label={t('list.remove', { item: format(v) })}
              onClick={() => onChange(values.filter((_, j) => j !== i))}
            >
              <span aria-hidden="true" className="text-sm leading-none">×</span>
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
        <p id={`${id}-h`} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-e`} role="alert" className="text-xs text-danger font-medium">
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
      <input
        id={id}
        type="checkbox"
        className="size-5 rounded-md border-line text-primary focus:ring-primary/20 accent-primary"
        aria-describedby={hint ? `${id}-h` : undefined}
        {...rest}
      />
      <div className="flex flex-col">
        <label htmlFor={id} className="cursor-pointer font-medium text-ink text-sm sm:text-base">
          {label}
        </label>
        {hint && (
          <span id={`${id}-h`} className="text-xs text-muted">
            {hint}
          </span>
        )}
      </div>
    </div>
  );
}

export function TextArea({ label, error, hint, ...rest }: { label: string; error?: string; hint?: string } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
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
        className={`min-h-24 rounded-input border bg-surface p-3 font-mono text-sm transition-all focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none ${
          error ? 'border-danger' : 'border-line hover:border-ink-2/30'
        }`}
        {...rest}
      />
      {hint && !error && (
        <p id={`${id}-h`} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-e`} role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export function PagerControls({
  page,
  canPrev,
  nextCursor,
  onPrev,
  onNext,
}: {
  page: number;
  canPrev: boolean;
  nextCursor: string | null | undefined;
  onPrev: () => void;
  onNext: (c: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <nav aria-label={t('pager.label')} className="mt-5 flex items-center justify-between gap-3 rounded-xl bg-surface p-2 shadow-card ring-1 ring-line">
      <Button variant="secondary" size="md" disabled={!canPrev} onClick={onPrev}>
        <span aria-hidden="true" className="rtl:rotate-180">←</span> {t('pager.prev')}
      </Button>
      <span className="text-xs sm:text-sm font-medium font-mono text-muted bg-canvas px-3 py-1 rounded-md">
        {t('pager.page', { page })}
      </span>
      <Button variant="secondary" size="md" disabled={!nextCursor} onClick={() => nextCursor && onNext(nextCursor)}>
        {t('pager.next')} <span aria-hidden="true" className="rtl:rotate-180">→</span>
      </Button>
    </nav>
  );
}

export function Table({ caption, head, children, className }: { caption: string; head: string[]; children: ReactNode; className?: string }) {
  return (
    <div className={`overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface shadow-card custom-scrollbar ${className ?? ''}`}>
      <table className="w-full border-collapse text-sm [&_tbody_tr]:transition-colors [&_tbody_tr:hover]:bg-primary-wash/60">
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 z-10 bg-canvas/80 backdrop-blur-sm border-b border-line">
          <tr>
            {head.map((h, i) => (
              <th key={i} scope="col" className="eyebrow px-4 pt-3.5 pb-3 text-start whitespace-nowrap text-muted font-bold text-xs">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line/60">{children}</tbody>
      </table>
    </div>
  );
}

export const Td = ({ children, className, colSpan }: { children?: ReactNode; className?: string; colSpan?: number }) => (
  <td colSpan={colSpan} className={`px-4 py-3 text-start align-middle ${className ?? ''}`}>{children}</td>
);

/** Tenant status as text plus a marker shape and pulsing live dot for active/trial. */
export function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const tone = status === 'active' ? 'ok' : status === 'trial' ? 'info' : status === 'past_due' ? 'warn' : 'danger';
  const isLive = status === 'active' || status === 'trial';
  return (
    <Pill tone={tone} className="gap-1.5 shadow-sm">
      {isLive && <span className="nova-live-dot size-1.5 bg-current" aria-hidden="true" />}
      {t(`tenantStatus.${status}`, { defaultValue: status })}
    </Pill>
  );
}

/** Placeholder rows while a table loads. */
export function TableSkeleton({ label, rows = 6 }: { label: string; rows?: number }) {
  return (
    <div role="status" className="flex flex-col gap-3 rounded-[var(--radius-card)] bg-surface p-5 shadow-card border border-line">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-4 w-1/4 rounded-md" />
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-10 w-full rounded-lg" />
      ))}
    </div>
  );
}

/** Cancel + submit row used by dialogs. */
export function FormButtons({ onCancel, busy, label, danger }: { onCancel: () => void; busy: boolean; label: string; danger?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap justify-end gap-2.5 pt-2">
      <Button type="button" variant="secondary" onClick={onCancel}>
        {t('common:cancel')}
      </Button>
      <Button type="submit" variant={danger ? 'danger' : 'primary'} busy={busy}>
        {label}
      </Button>
    </div>
  );
}
