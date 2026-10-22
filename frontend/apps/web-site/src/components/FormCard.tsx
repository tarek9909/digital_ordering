import { Card } from '@dop/ui';
import type { ReactNode } from 'react';

/** Narrow centred card used by the auth pages. */
export function FormCard({ title, intro, children }: { title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-md px-4 py-10">
      <Card className="flex flex-col gap-4 p-6">
        <h1 className="text-2xl font-bold">{title}</h1>
        {intro && <div className="text-muted">{intro}</div>}
        {children}
      </Card>
    </div>
  );
}

export function FormError({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 font-medium text-danger">
      <span aria-hidden="true">⚠ </span>
      {text}
    </p>
  );
}
