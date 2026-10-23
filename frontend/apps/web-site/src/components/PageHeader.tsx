import type { ReactNode } from 'react';

// Shared look for the site's inner pages (pricing, contact, sign-in, password, legal): a display title with a short
// lead, the page's one entrance moment (data-motion="page"), on the same type scale as the landing page.

/** Pill links: `primary` is the page's one ember action, `ink` a strong secondary, `quiet` an outline. */
export const pillLink = {
  primary:
    'inline-flex min-h-12 items-center justify-center gap-2 rounded-control bg-primary px-6 font-semibold text-on-primary shadow-button transition-[background-color,transform] duration-150 hover:-translate-y-px hover:bg-primary-hover active:scale-[.98]',
  ink: 'inline-flex min-h-12 items-center justify-center gap-2 rounded-control bg-ink px-6 font-semibold text-white shadow-button transition-[background-color,transform] duration-150 hover:-translate-y-px hover:bg-ink-2 active:scale-[.98]',
  quiet: 'inline-flex min-h-12 items-center justify-center gap-2 rounded-control border border-line bg-surface px-6 font-semibold text-ink transition-colors hover:border-ink-2/30 hover:bg-canvas',
};

/** An underlined text link in body copy. */
export const textLink = 'inline-flex min-h-12 items-center font-semibold text-ink underline decoration-line decoration-2 underline-offset-[6px] transition-colors hover:decoration-ink';

export function PageHeader({
  eyebrow,
  title,
  lead,
  center,
  compact,
  children,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  lead?: ReactNode;
  center?: boolean;
  /** Smaller title for the narrow auth column. */
  compact?: boolean;
  children?: ReactNode;
}) {
  return (
    <header data-motion="page" className={`flex flex-col gap-4 ${center ? 'items-center text-center' : ''}`}>
      {eyebrow && <span className="eyebrow">{eyebrow}</span>}
      <h1 className={`font-display font-extrabold tracking-tight text-balance ${compact ? 'text-[2rem] leading-tight sm:text-[2.5rem]' : 'text-[2.5rem] leading-[1.05] sm:text-6xl'}`}>{title}</h1>
      {lead && <div className={`max-w-2xl text-ink-2 ${compact ? 'text-base sm:text-lg' : 'text-lg sm:text-xl'}`}>{lead}</div>}
      {children}
    </header>
  );
}

/** The column an inner page sits in (the layout gives inner pages the canvas tone). */
export function InnerPage({ children, width = 'max-w-5xl' }: { children: ReactNode; width?: string }) {
  return <div className={`mx-auto flex w-full ${width} flex-col gap-10 px-4 pt-12 pb-20 sm:px-8 sm:pt-20 sm:pb-28`}>{children}</div>;
}
