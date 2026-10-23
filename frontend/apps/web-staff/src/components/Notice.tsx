import { BrandMark } from '@dop/ui';
import type { ReactNode } from 'react';

/** Full-page message (signed out, subscription required, invalid link): the brand ring, a title and what to do. */
export function Notice({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-canvas p-6 text-center">
      <div className="flex max-w-md flex-col items-center gap-5 rounded-[var(--radius-card)] bg-surface px-8 py-10 shadow-card">
        <span data-motion="draw" className="contents">
          <BrandMark className="size-14" />
        </span>
        <h1 className="font-display text-2xl leading-tight font-extrabold tracking-tight sm:text-3xl">{title}</h1>
        {children && <div className="text-lg text-ink-2">{children}</div>}
      </div>
    </main>
  );
}
