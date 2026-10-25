import { useTranslation } from '@dop/i18n';
import { PageShell } from '@dop/ui';
import { useSearchParams } from 'react-router';
import { useMe } from '../lib/me';
import { can, type ConsolePermission } from '../lib/roles';
import { AuditBody } from './Audit';
import { PilotReportBody } from './PilotReport';
import { PlatformReportBody } from './PlatformReport';

// One Reports page, one sub-tab per report plus the audit log; the tab lives in ?tab= so a link opens the right one.
const TABS = [
  { key: 'platform', label: 'nav.platformReport', perm: 'reports' },
  { key: 'pilot', label: 'nav.reports', perm: 'reports' },
  { key: 'audit', label: 'nav.audit', perm: 'audit' },
] as const satisfies readonly { key: string; label: string; perm: ConsolePermission }[];

export function ReportsPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const role = useMe().data?.platformUser.role;
  const tabs = TABS.filter((x) => can(role, x.perm));
  const tab = (tabs.find((x) => x.key === params.get('tab')) ?? tabs[0])?.key;
  return (
    <PageShell wide eyebrow={t('layout.groups.insights')} title={t('reportsHub.title')} description={t('reportsHub.description')}>
      <div role="tablist" aria-label={t('reportsHub.title')} className="mb-4 flex gap-1 overflow-x-auto border-b border-line">
        {tabs.map((x) => (
          <button
            key={x.key}
            type="button"
            role="tab"
            id={`reports-tab-${x.key}`}
            aria-selected={tab === x.key}
            aria-controls="reports-panel"
            onClick={() => setParams({ tab: x.key }, { replace: true })}
            className={`min-h-12 shrink-0 px-4 text-sm font-semibold lg:min-h-10 ${tab === x.key ? 'border-b-2 border-primary text-ink' : 'text-muted hover:text-ink'}`}
          >
            {t(x.label)}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="reports-panel" aria-labelledby={tab ? `reports-tab-${tab}` : undefined}>
        {tab === 'pilot' ? <PilotReportBody /> : tab === 'audit' ? <AuditBody /> : tab === 'platform' ? <PlatformReportBody /> : null}
      </div>
    </PageShell>
  );
}
