import type { ReactNode } from 'react';

/** Full-page message (signed out, subscription required, invalid link). */
export function Notice({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-canvas p-6 text-center">
      <h1 className="text-3xl font-bold">{title}</h1>
      {children && <div className="max-w-md text-lg text-muted">{children}</div>}
    </main>
  );
}
