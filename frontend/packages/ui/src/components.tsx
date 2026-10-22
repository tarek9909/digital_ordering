import * as Dialog from '@radix-ui/react-dialog';
import { Component, forwardRef, useCallback, useEffect, useId, useState, type ButtonHTMLAttributes, type ErrorInfo, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';

// Accessible base components (TR-A11Y-01). Touch targets ≥ 48 px, main actions ≥ 64 px (TR-FE-13).

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'brand';
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'md' | 'lg' | 'xl';
  busy?: boolean;
}

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-primary text-on-primary hover:bg-primary-hover',
  secondary: 'bg-surface text-ink border border-line hover:bg-canvas',
  danger: 'bg-danger text-white hover:brightness-110',
  ghost: 'bg-transparent text-ink hover:bg-canvas',
  brand: 'bg-[var(--brand)] text-[var(--on-brand)] hover:brightness-110',
};
const SIZES = { md: 'min-h-12 px-4 text-base', lg: 'min-h-16 px-6 text-lg', xl: 'min-h-20 px-8 text-2xl' };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = 'primary', size = 'md', busy, disabled, className, children, ...rest }, ref) {
  return (
    <button
      ref={ref}
      className={cx('inline-flex min-w-12 items-center justify-center gap-2 rounded-control font-semibold transition active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-50', VARIANTS[variant], SIZES[size], className)}
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

export function Card({ children, className, ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-card', className)} {...rest}>
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
    <div className={cx('flex flex-col gap-1', className)}>
      <label htmlFor={fid} className="font-medium">
        {label}
      </label>
      <input
        ref={ref}
        id={fid}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${fid}-err` : hint ? `${fid}-hint` : undefined}
        className={cx('min-h-12 rounded-input border bg-surface px-3 text-base', error ? 'border-danger' : 'border-line')}
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
    <div className={cx('flex flex-col gap-1', className)}>
      <label htmlFor={fid} className="font-medium">
        {label}
      </label>
      <select id={fid} className="min-h-12 rounded-input border border-line bg-surface px-3 text-base" {...rest}>
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
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cx('flex flex-wrap items-center justify-between gap-3 px-4 py-3 font-medium', tones[tone])}>
      <div>{children}</div>
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
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content className="fixed inset-x-4 top-[10vh] z-50 mx-auto max-h-[80vh] max-w-lg overflow-auto rounded-dialog bg-surface p-5 shadow-xl">
          <Dialog.Title className="mb-2 font-display text-xl font-bold">{title}</Dialog.Title>
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
    <div aria-live="polite" className="fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4">
      {items.map((t) => (
        <div key={t.id} className={cx('flex w-full max-w-xl items-center justify-between gap-4 rounded-input px-4 py-3 text-white shadow-lg', t.tone === 'danger' ? 'bg-danger' : t.tone === 'ok' ? 'bg-ok' : 'bg-ink')}>
          <span>{t.text}</span>
          {t.action && (
            <button className="min-h-12 rounded-md bg-white/20 px-4 font-bold" onClick={() => (t.action!.onClick(), onDismiss(t.id))}>
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

/** Visually hidden live region for status announcements (TR-A11Y-02). */
export function LiveRegion({ text, assertive }: { text: string; assertive?: boolean }) {
  return (
    <div className="sr-only" aria-live={assertive ? 'assertive' : 'polite'} role={assertive ? 'alert' : 'status'}>
      {text}
    </div>
  );
}

export function PageShell({ title, actions, children, nav }: { title: string; actions?: ReactNode; nav?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-canvas">
      {nav}
      <main className="mx-auto max-w-5xl px-4 py-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-display text-2xl font-bold tracking-tight">{title}</h1>
          {actions}
        </div>
        {children}
      </main>
    </div>
  );
}
