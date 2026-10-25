import type { AuditPurpose } from '@dop/contracts';
import type { ReactNode } from 'react';

/** The server still records a purpose with every audit entry (TR-FE-25); opening a tenant no longer asks for one. */
const DEFAULT_PURPOSE: AuditPurpose = 'support';

export function PurposeGate({ children }: { tenantId: string; children: (purpose: AuditPurpose) => ReactNode }) {
  return <>{children(DEFAULT_PURPOSE)}</>;
}
