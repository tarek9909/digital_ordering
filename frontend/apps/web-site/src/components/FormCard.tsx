import { Card } from '@dop/ui';
import type { ReactNode } from 'react';
import { InnerPage, PageHeader } from './PageHeader';

/** Narrow centred column used by the auth pages: the title and intro arrive above a floating card. */
export function FormCard({ title, intro, children }: { title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <InnerPage width="max-w-md">
      <div className="flex flex-col gap-8 sm:-mt-4">
        <PageHeader compact title={title} lead={intro} />
        <Card className="flex flex-col gap-5 p-6 sm:p-8">{children}</Card>
      </div>
    </InnerPage>
  );
}

/** A form-level error: text plus a square marker, never colour alone. */
export function FormError({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p role="alert" className="flex items-start gap-3 rounded-input bg-danger-bg px-4 py-3 font-medium text-danger">
      <span aria-hidden="true" className="mt-2 size-2 shrink-0 rounded-[2px] bg-current" />
      <span>{text}</span>
    </p>
  );
}
