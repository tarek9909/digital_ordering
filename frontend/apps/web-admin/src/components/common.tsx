import { useTranslation } from '@dop/i18n';
import { Banner, Button, Modal, Pill, Skeleton, Spinner } from '@dop/ui';
import { createContext, useContext, useId, useState, type InputHTMLAttributes, type ReactNode, type Ref, type TextareaHTMLAttributes } from 'react';
import { Link } from 'react-router';
import { errorText, isCode } from '../lib/errors';
import { useRole } from '../lib/me';

// Local building blocks of the restaurant admin, on top of @dop/ui. Pages sit on the canvas as flat, bordered panels;
// the one raised surface on a page is its headline figures (brand: Ember).

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

type LinkVariant = 'primary' | 'secondary' | 'ink' | 'ghost' | 'quiet';
const LINK_VARIANTS: Record<LinkVariant, string> = {
  primary: 'bg-primary text-on-primary shadow-button hover:bg-primary-hover hover:-translate-y-px',
  ink: 'bg-panel text-white shadow-button hover:bg-panel-2 hover:-translate-y-px',
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
        <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-5">
          <Skeleton className="h-3 w-1/3" />
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      )}
      {kind === 'cards' && (
        <div className="grid gap-4 md:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-5">
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-12 w-40 rounded-control" />
            </div>
          ))}
        </div>
      )}
      {kind === 'tiles' && (
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-card)] border border-line bg-line lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex flex-col gap-3 bg-surface p-5">
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-9 w-2/3" />
            </div>
          ))}
        </div>
      )}
      {kind === 'form' && (
        <div className="flex max-w-xl flex-col gap-4 rounded-[var(--radius-card)] border border-line bg-surface p-5">
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

/**
 * A page: a large title over a hairline, an optional description and actions, then the content. The header is the
 * page's one entrance moment (data-motion="page"). Content lines up with the sidebar rather than floating centred.
 */
export function Page({ title, description, actions, tabs, children }: { title: string; description?: ReactNode; actions?: ReactNode; tabs?: ReactNode; children: ReactNode }) {
  return (
    <main className="px-4 py-6 sm:px-8 sm:py-8 lg:px-10">
      <header className="mb-7 flex flex-wrap items-end justify-between gap-4 border-b border-line pb-6">
        <div data-motion="page" className="flex min-w-0 flex-col gap-2">
          <h1 className="font-display text-[2rem] leading-[1.05] font-extrabold tracking-[-0.025em] break-words sm:text-[2.5rem]">{title}</h1>
          {description && <p className="max-w-2xl text-ink-2">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      {tabs}
      {children}
    </main>
  );
}

/**
 * One tab of a TabbedPage: the page's title and tab bar sit above it, so a tab carries only its own description and
 * actions in a quieter row before the content.
 */
export function TabPanel({ description, actions, children }: { description?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <>
      {(description || actions) && (
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          {description && <p className="max-w-2xl min-w-0 text-ink-2">{description}</p>}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </>
  );
}

/** Set inside a Section, so a Table there runs edge to edge instead of drawing a second frame. */
const InPanel = createContext(false);

/** One topic of a page (a form, a list, a setting): a flat panel with its heading ruled off from the content. */
export function Section({
  title,
  description,
  children,
  actions,
  tone,
  className,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  tone?: 'danger';
  className?: string;
}) {
  const id = useId();
  return (
    <section className={cx('overflow-clip rounded-[var(--radius-card)] border bg-surface', tone === 'danger' ? 'border-danger/25' : 'border-line', className ?? 'mb-6')} aria-labelledby={id}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 pt-5 pb-4 sm:px-6">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id={id} className={cx('text-lg leading-snug font-bold', tone === 'danger' && 'text-danger')}>
            {title}
          </h2>
          {description && <p className="max-w-2xl text-sm text-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className="px-5 py-5 sm:px-6">
        <InPanel.Provider value={true}>{children}</InPanel.Provider>
      </div>
    </section>
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
 * Data table: eyebrow column heads, warm row hover, numbers in tabular figures. On its own it is a bordered panel
 * (`raised` adds the soft shadow); inside a Section it runs to the panel's edges, and meets its heading rule or
 * bottom edge when it opens or closes the panel.
 */
export function Table({ caption, head, children, raised, bodyRef }: { caption: string; head: string[]; children: ReactNode; raised?: boolean; bodyRef?: Ref<HTMLTableSectionElement> }) {
  const inPanel = useContext(InPanel);
  return (
    <div
      className={cx(
        'overflow-x-auto bg-surface',
        inPanel
          ? '-mx-5 border-y border-line first:-mt-5 first:border-t-0 last:-mb-5 last:border-b-0 sm:-mx-6 [&_td:first-child]:ps-5 [&_td:last-child]:pe-5 [&_th:first-child]:ps-5 sm:[&_td:first-child]:ps-6 sm:[&_td:last-child]:pe-6 sm:[&_th:first-child]:ps-6'
          : 'rounded-[var(--radius-card)] border border-line',
        raised && !inPanel && 'shadow-card',
      )}
    >
      <table className="w-full border-collapse text-sm [&_tbody_tr]:transition-colors [&_tbody_tr:hover]:bg-primary-wash">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-canvas/60">
          <tr>
            {head.map((h, i) => (
              <th key={`${h}-${i}`} scope="col" className="eyebrow px-4 py-3 text-start whitespace-nowrap">
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
  <td className={cx('border-t border-line px-4 py-3 align-middle', !className?.includes('text-end') && 'text-start', className)}>{children}</td>
);

/**
 * Headline figures as ruled cells of one slip, like the boxes on a printed ticket: hairlines between cells, one soft
 * shadow under the whole (`flat` inside a panel). Give it a column count that divides the cells, so no empty box shows.
 */
export function Figures({ children, className, label, flat }: { children: ReactNode; className?: string; label?: string; flat?: boolean }) {
  return (
    <div
      data-motion="stagger"
      role={label ? 'group' : undefined}
      aria-label={label}
      className={cx('grid gap-px overflow-hidden rounded-[var(--radius-card)] border border-line bg-line', !flat && 'shadow-card', className)}
    >
      {children}
    </div>
  );
}

/**
 * One cell of Figures, or a figure on its own. `lead` makes it the page's live number (the one ember element). The
 * number scales with the cell (container units), so a duration like "1:05:30" still fits a half-width cell at 320px.
 */
export function Stat({ label, value, hint, lead, className }: { label: ReactNode; value: ReactNode; hint?: ReactNode; lead?: boolean; className?: string }) {
  return (
    <div className={cx('@container flex min-w-0 flex-col gap-2 bg-surface p-4 sm:p-5', className)}>
      <span className="eyebrow">{label}</span>
      <span
        data-motion="count"
        className={cx('num font-display leading-none font-extrabold tracking-tight', lead ? 'text-[length:clamp(2.25rem,30cqi,3.75rem)] text-primary' : 'text-[length:clamp(1.5rem,26cqi,2.25rem)]')}
      >
        {value}
      </span>
      {hint && <span className="text-sm text-muted">{hint}</span>}
    </div>
  );
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

/** Separate, rectangular white boxes with a thin grey border; the chosen one has brand text, lifts and glows in the brand colour. Shared by Tabs and SubNav. */
export const tabBarClass = 'mb-8 flex flex-wrap items-end gap-3 pt-1';
export const tabClass = (on: boolean) =>
  cx(
    'inline-flex min-h-10 shrink-0 items-center rounded-md border-2 border-line bg-surface px-5 text-sm font-semibold whitespace-nowrap transition-[color,transform,box-shadow] duration-300 ease-out motion-reduce:transition-none',
    on
      ? '-translate-y-0.5 text-primary shadow-[0_3px_6px_-4px_color-mix(in_srgb,var(--color-primary)_30%,transparent)]'
      : 'text-muted hover:-translate-y-0.5 hover:text-primary hover:shadow-[0_3px_6px_-5px_color-mix(in_srgb,var(--color-primary)_18%,transparent)]',
  );

/** Tabs as brand-bordered boxes; the chosen one is filled. The caller renders the matching role="tabpanel". */
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
    <div role="tablist" aria-label={label} className={tabBarClass}>
      {tabs.map((k) => (
        <button
          key={k}
          type="button"
          role="tab"
          id={`${idPrefix}tab-${k}`}
          aria-selected={value === k}
          aria-controls={`${idPrefix}panel-${k}`}
          onClick={() => onChange(k)}
          className={tabClass(value === k)}
        >
          {labelOf(k)}
        </button>
      ))}
    </div>
  );
}

export type TabSection = { key: string; label: string; node: ReactNode };

/**
 * A page of several containers shown one at a time as tabs. Falsy entries are skipped; with a single section the tab bar
 * is dropped. A URL hash equal to a section key (e.g. #deletion) opens that section first.
 */
export function SectionTabs({ label, sections, idPrefix = 's' }: { label: string; sections: ReadonlyArray<TabSection | false | null | undefined>; idPrefix?: string }) {
  const list = sections.filter((s): s is TabSection => Boolean(s));
  const keys = list.map((s) => s.key);
  const [picked, setPicked] = useState(() => {
    const h = typeof window === 'undefined' ? '' : window.location.hash.slice(1);
    return keys.includes(h) ? h : '';
  });
  const current = list.find((s) => s.key === picked) ?? list[0];
  if (!current) return null;
  if (list.length === 1) return <>{current.node}</>;
  return (
    <>
      <Tabs label={label} tabs={keys} value={current.key} onChange={setPicked} idPrefix={idPrefix} labelOf={(k) => list.find((s) => s.key === k)?.label ?? k} />
      <div role="tabpanel" id={`${idPrefix}panel-${current.key}`} aria-labelledby={`${idPrefix}tab-${current.key}`}>
        {current.node}
      </div>
    </>
  );
}

/** A "+ Add" button that opens a pop-up. The form gets `close`; the pop-up unmounts on close, so the form starts empty each time. */
export function AddDialog({ label, title, description, children }: { label: string; title: string; description?: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <span aria-hidden="true">+</span>
        {label}
      </Button>
      <Modal open={open} onOpenChange={setOpen} title={title} description={description}>
        {children(() => setOpen(false))}
      </Modal>
    </>
  );
}

/** Cancel + submit row at the foot of a pop-up form. */
export function DialogActions({ onCancel, submitLabel, busy, variant = 'primary' }: { onCancel: () => void; submitLabel: string; busy?: boolean; variant?: 'primary' | 'ink' | 'danger' }) {
  const { t } = useTranslation();
  return (
    <div className="mt-1 flex flex-wrap justify-end gap-3">
      <Button type="button" variant="secondary" onClick={onCancel}>
        {t('common:cancel')}
      </Button>
      <Button type="submit" variant={variant} busy={busy}>
        {submitLabel}
      </Button>
    </div>
  );
}
