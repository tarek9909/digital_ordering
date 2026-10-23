import { BrandMark } from '@dop/ui';
import type { ReactNode } from 'react';

/** Full-page message (signed out, subscription required, invalid link): the brand ring, a title and what to do. */
export function Notice({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-canvas p-4 text-center sm:p-6">
      <div className="flex max-w-md flex-col items-center gap-5 rounded-[var(--radius-card)] bg-surface px-6 py-8 shadow-card sm:px-8 sm:py-10">
        <span data-motion="draw" className="contents">
          <BrandMark className="size-14" />
        </span>
        <h1 className="font-display text-2xl leading-tight font-extrabold tracking-tight sm:text-3xl">{title}</h1>
        {children && <div className="text-lg text-ink-2">{children}</div>}
      </div>
    </main>
  );
}
