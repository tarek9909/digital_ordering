import * as Dialog from '@radix-ui/react-dialog';
import { Component, forwardRef, useCallback, useEffect, useId, useState, type ButtonHTMLAttributes, type ErrorInfo, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';

// Accessible base components (TR-A11Y-01). Touch targets ≥ 48 px, main actions ≥ 64 px (TR-FE-13).

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'brand' | 'ink';
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'md' | 'lg' | 'xl';
  busy?: boolean;
}

// Filled buttons lift a hair on hover and sink on press; outline and ghost buttons only change tone.
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-primary text-on-primary shadow-button hover:bg-primary-hover enabled:hover:-translate-y-px',
  secondary: 'bg-surface text-ink border border-line hover:border-ink-2/30 hover:bg-canvas',
  danger: 'bg-danger text-white shadow-button hover:brightness-110 enabled:hover:-translate-y-px',
  ghost: 'bg-transparent text-ink hover:bg-canvas',
  brand: 'bg-[var(--brand)] text-[var(--on-brand)] shadow-button hover:brightness-110 enabled:hover:-translate-y-px',
  ink: 'bg-panel text-white shadow-button hover:bg-panel-2 enabled:hover:-translate-y-px',
};
const SIZES = { md: 'min-h-12 px-4 text-base', lg: 'min-h-16 px-6 text-lg', xl: 'min-h-20 px-8 text-2xl' };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = 'primary', size = 'md', busy, disabled, className, children, ...rest }, ref) {
  return (
    <button
      ref={ref}
      className={cx(
        'inline-flex min-w-12 items-center justify-center gap-2 rounded-control font-semibold transition-[background-color,border-color,color,transform,filter] duration-150 enabled:active:translate-y-0 enabled:active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy && <Spinner />}
      {children}
    </button>
  );
});

export function Spinner({ label }: { label?: string }) {
  return (
    <span role={label ? 'status' : undefined} className="inline-block size-5 animate-spin rounded-full border-2 border-current border-e-transparent">
      {label && <span className="sr-only">{label}</span>}
    </span>
  );
}

/** Floating card (one soft shadow). `flat` is the bordered secondary card used inside other surfaces. */
export function Card({ children, className, flat, ...rest }: { children: ReactNode; className?: string; flat?: boolean } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('rounded-[var(--radius-card)] bg-surface p-5', flat ? 'border border-line' : 'shadow-card', className)} {...rest}>
      {children}
    </div>
  );
}

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
}

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field({ label, hint, error, className, id, ...rest }, ref) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={fid} className="text-sm font-semibold text-ink-2">
        {label}
      </label>
      <input
        ref={ref}
        id={fid}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${fid}-err` : hint ? `${fid}-hint` : undefined}
        className={cx('min-h-12 rounded-input border bg-surface px-3.5 text-base placeholder:text-muted/70 hover:border-ink-2/30', error ? 'border-danger' : 'border-line')}
        {...rest}
      />
      {hint && !error && (
        <p id={`${fid}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${fid}-err`} className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
});

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  options: Array<{ value: string; label: string }>;
}

export function Select({ label, options, id, className, ...rest }: SelectProps) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={fid} className="text-sm font-semibold text-ink-2">
        {label}
      </label>
      <select id={fid} className="select-chevron min-h-12 appearance-none rounded-input border border-line bg-surface ps-3.5 pe-10 text-base hover:border-ink-2/30" {...rest}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function Banner({ tone = 'info', children, action }: { tone?: 'info' | 'warn' | 'danger' | 'ok'; children: ReactNode; action?: ReactNode }) {
  const tones = { info: 'bg-info-bg text-info', warn: 'bg-warn-bg text-warn', danger: 'bg-danger-bg text-danger', ok: 'bg-ok-bg text-ok' };
  // A shape marker as well as the colour, so the tone never depends on colour alone.
  const marks = { info: 'rounded-full', warn: 'rotate-45 rounded-[2px]', danger: 'rounded-[2px]', ok: 'rounded-full' };
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cx('flex flex-wrap items-center justify-between gap-3 rounded-input px-4 py-3 font-medium', tones[tone])}>
      <div className="flex min-w-0 items-start gap-3">
        <span aria-hidden="true" className={cx('mt-2 size-2 shrink-0 bg-current', marks[tone])} />
        <div className="min-w-0">{children}</div>
      </div>
      {action}
    </div>
  );
}

/** Red offline bar: actions disabled until the snapshot reloads (TR-FE-15, FR-STF-14). */
export function OfflineBar({ text }: { text: string }) {
  return (
    <div role="alert" className="sticky top-0 z-50 bg-danger px-4 py-3 text-center text-lg font-bold text-white">
      {text}
    </div>
  );
}

export function Modal({ open, onOpenChange, title, children, description }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: string; children: ReactNode }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay fixed inset-0 z-40 bg-panel/45 backdrop-blur-[2px]" />
        {/* Phones: a sheet anchored to the bottom, within thumb reach and clear of the home indicator. */}
        <Dialog.Content className="dialog-content fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-50 mx-auto max-h-[calc(100dvh-1.5rem)] max-w-lg overflow-auto overscroll-contain rounded-dialog bg-surface p-5 shadow-dialog sm:inset-x-4 sm:top-[10dvh] sm:bottom-auto sm:max-h-[80dvh] sm:p-6">
          <Dialog.Title className="mb-2 font-display text-xl font-bold tracking-tight">{title}</Dialog.Title>
          {description ? <Dialog.Description className="mb-4 text-muted">{description}</Dialog.Description> : <Dialog.Description className="sr-only">{title}</Dialog.Description>}
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Full-screen sheet used for the new-ticket QR and the customer Ready screen. */
export function FullScreen({ children, className, label }: { children: ReactNode; className?: string; label: string }) {
  return (
    <div role="dialog" aria-modal="true" aria-label={label} className={cx('fixed inset-0 z-40 flex flex-col items-center justify-center overflow-auto p-4', className)}>
      {children}
    </div>
  );
}

export interface ToastItem {
  id: number;
  text: string;
  tone?: 'info' | 'danger' | 'ok';
  action?: { label: string; onClick: () => void };
  ttlMs?: number;
}

/** Toasts with an optional action (Undo bar, conflict notices). Announced politely (TR-A11Y-02). */
export function Toasts({ items, onDismiss }: { items: ToastItem[]; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const timers = items.map((t) => setTimeout(() => onDismiss(t.id), t.ttlMs ?? 6000));
    return () => timers.forEach(clearTimeout);
  }, [items, onDismiss]);
  return (
    <div aria-live="polite" className="fixed inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] z-50 flex flex-col items-center gap-2 px-4">
      {items.map((t) => (
        <div key={t.id} className={cx('toast-in flex w-full max-w-xl flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-input px-4 py-3 text-white shadow-dialog', t.tone === 'danger' ? 'bg-danger' : t.tone === 'ok' ? 'bg-ok' : 'bg-panel')}>
          <span className="flex min-w-0 items-center gap-3">
            <span aria-hidden="true" className={cx('size-1.5 shrink-0 rounded-full', t.tone ? 'bg-white' : 'bg-glow')} />
            {t.text}
          </span>
          {t.action && (
            <button className="min-h-12 rounded-control bg-white/15 px-5 font-bold transition-colors hover:bg-white/25" onClick={() => (t.action!.onClick(), onDismiss(t.id))}>
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export function useToasts() {
  const [items, setItems] = useState<ToastItem[]>([]);
  // Stable callbacks so the Toasts timers are not restarted on every render.
  const push = useCallback((t: Omit<ToastItem, 'id'>) => setItems((x) => [...x, { ...t, id: Date.now() + Math.random() }]), []);
  const dismiss = useCallback((id: number) => setItems((x) => x.filter((t) => t.id !== id)), []);
  return { items, push, dismiss };
}

/** Error boundary on every route (TR-FE-04); reports go to Sentry when configured. */
export class ErrorBoundary extends Component<{ children: ReactNode; fallback: ReactNode; onError?: (e: Error, info: ErrorInfo) => void }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: Error, info: ErrorInfo) {
    this.props.onError?.(error, info);
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/**
 * Live region for status announcements (TR-A11Y-02). A non-empty text can also be shown as a brief success toast:
 * an announcement can be made visible with `toast` (the admin and console dashboards use it).
 */
export function LiveRegion({ text, assertive, toast }: { text: string; assertive?: boolean; toast?: boolean }) {
  const [shown, setShown] = useState('');
  useEffect(() => {
    if (!toast || !text) {
      setShown('');
      return;
    }
    setShown(text);
    const timer = setTimeout(() => setShown(''), 4000);
    return () => clearTimeout(timer);
  }, [text, toast]);
  return (
    <>
      <div className="sr-only" aria-live={assertive ? 'assertive' : 'polite'} role={assertive ? 'alert' : 'status'}>
        {text}
      </div>
      {shown && (
        <div aria-hidden="true" className="pointer-events-none fixed inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] z-50 flex justify-center px-4">
          <div className="toast-in flex w-full max-w-xl items-center gap-3 rounded-input bg-ok px-4 py-3 text-white shadow-dialog">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-5 shrink-0">
              <path d="M4 10.5l4 4 8-9" />
            </svg>
            <span className="min-w-0">{shown}</span>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * A page: header (optional eyebrow, title, description, actions) and content. The header is the page's one
 * entrance moment (data-motion="page"). `wide` is for dashboards and tables.
 */
export function PageShell({
  title,
  actions,
  children,
  nav,
  eyebrow,
  description,
  wide,
}: {
  title: string;
  actions?: ReactNode;
  nav?: ReactNode;
  children: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="min-h-dvh bg-canvas">
      {nav}
      <main className={cx('mx-auto px-4 py-6 sm:px-6 sm:py-8', wide ? 'max-w-7xl' : 'max-w-5xl')}>
        <header className="mb-6 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
          <div data-motion="page" className="flex min-w-0 flex-col gap-1.5">
            {eyebrow && <span className="eyebrow">{eyebrow}</span>}
            <h1 className="font-display text-[1.75rem] leading-tight font-extrabold tracking-tight sm:text-[2rem]">{title}</h1>
            {description && <p className="max-w-2xl text-ink-2">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
        {children}
      </main>
    </div>
  );
}

/** A figure with a label: the big number in display type, the label as an eyebrow. Counts up once. */
export function Stat({ label, value, hint, accent, className }: { label: ReactNode; value: ReactNode; hint?: ReactNode; accent?: boolean; className?: string }) {
  return (
    <div className={cx('flex min-w-0 flex-col gap-2 rounded-[var(--radius-card)] p-4 sm:p-5', accent ? 'ember-glow ember-glow-sm bg-panel text-white shadow-card' : 'bg-surface shadow-card', className)}>
      <span className={cx('eyebrow', accent && 'text-white/65')}>{label}</span>
      <span data-motion="count" className={cx('num font-display text-3xl leading-none font-extrabold tracking-tight break-words sm:text-4xl', accent && 'text-glow')}>
        {value}
      </span>
      {hint && <span className={cx('text-sm', accent ? 'text-white/70' : 'text-muted')}>{hint}</span>}
    </div>
  );
}

/** Nothing here yet: say what this place is for and offer the first action. */
export function EmptyState({ title, children, action, className }: { title: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx('flex flex-col items-center gap-3 rounded-[var(--radius-card)] border border-dashed border-line bg-surface px-6 py-12 text-center', className)}>
      <svg viewBox="0 0 64 64" aria-hidden="true" className="size-12 text-line">
        <path d="M32 18a14 14 0 1 1-12.124 7" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
        <circle cx="19.876" cy="25" r="5" className="fill-primary" />
      </svg>
      <p className="font-display text-lg font-bold">{title}</p>
      {children && <div className="max-w-md text-ink-2">{children}</div>}
      {action}
    </div>
  );
}

/** Small status pill: text plus a marker shape, never colour alone. */
export function Pill({ tone = 'neutral', children, className }: { tone?: 'neutral' | 'ok' | 'warn' | 'danger' | 'info' | 'ink' | 'ember'; children: ReactNode; className?: string }) {
  const tones = {
    neutral: 'bg-canvas text-ink-2 ring-1 ring-line',
    ok: 'bg-ok-bg text-ok',
    warn: 'bg-warn-bg text-warn',
    danger: 'bg-danger-bg text-danger',
    info: 'bg-info-bg text-info',
    ink: 'bg-panel text-white',
    ember: 'bg-primary-soft text-primary-hover',
  };
  const marks = { neutral: '○', ok: '●', warn: '▲', danger: '■', info: '◐', ink: '●', ember: '●' };
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap', tones[tone], className)}>
      <span aria-hidden="true" className="text-[0.625rem] leading-none">
        {marks[tone]}
      </span>
      {children}
    </span>
  );
}

/** Placeholder while content loads. */
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cx('skeleton block rounded-input bg-line/70', className)} />;
}
