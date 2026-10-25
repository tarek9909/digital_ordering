import { legalDocumentBody } from '@dop/contracts';
import { useTranslation } from '@dop/i18n';
import { Banner, LiveRegion, PageShell, Pill, Spinner } from '@dop/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { z } from 'zod';
import { ErrorNote, FormButtons, Section, Segmented, tabPanelProps, Tabs, TextArea } from '../components/common';
import { MfaCancelled, useFreshMfa } from '../components/FreshMfa';
import { api } from '../lib/api';
import { htmlToText, textToHtml } from '../lib/legalText';
import type { PushKeyStatus } from '../lib/types';

// Legal documents and push key status (FR-SA-12, TR-PRV-09).

const LOCALES = ['ar', 'en'] as const;
const KINDS = legalDocumentBody.shape.kind.options;
type Tab = 'legal' | 'push';

export function ContentPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('legal');
  const [announce, setAnnounce] = useState('');
  return (
    <PageShell wide eyebrow={t('layout.groups.platform')} title={t('content.title')} description={t('content.description')}>
      <LiveRegion toast text={announce} />
      <Tabs
        id="content"
        label={t('content.title')}
        value={tab}
        onChange={setTab}
        tabs={[
          {
            value: 'legal',
            label: t('content.legal.title'),
            icon: (
              <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            ),
          },
          {
            value: 'push',
            label: t('content.push.title'),
            icon: (
              <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
            ),
          },
        ]}
      />
      <div {...tabPanelProps('content', 'legal')} hidden={tab !== 'legal'}>
        <Legal onAnnounce={setAnnounce} />
      </div>
      {tab === 'push' && (
        <div {...tabPanelProps('content', 'push')}>
          <PushKeys />
        </div>
      )}
    </PageShell>
  );
}

const stamp = () => new Date().toISOString().replace(/\D/g, '').replace(/^(\d{8})(\d{6}).*/, '$1-$2'); // a version label, unique to the second
type Kind = (typeof KINDS)[number];
type Locale = (typeof LOCALES)[number];
const slot = (k: Kind, l: Locale) => `${k}:${l}`;

/** The four documents as direct inputs: the published text is loaded, edited here, and one button publishes every change. */
function Legal({ onAnnounce }: { onAnnounce: (s: string) => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const run = useFreshMfa(); // publishing asks every tenant user to accept: the server asks for a recent code
  const [locale, setLocale] = useState<Locale>('ar');
  const [kind, setKind] = useState<Kind>(KINDS[0]);
  const [edits, setEdits] = useState<Record<string, string>>({}); // only what was changed; the rest shows the saved text
  const [empty, setEmpty] = useState<Set<string>>(new Set());
  const current = useQuery({ queryKey: ['legal-current'], queryFn: () => api.get<{ items: { kind: Kind; locale: Locale; html: string; version: string | null }[] }>('/legal-documents/current') });
  const saved = (k: Kind, l: Locale) => current.data?.items.find((i) => i.kind === k && i.locale === l);
  const plain = (k: Kind, l: Locale) => htmlToText(saved(k, l)?.html ?? '');
  const save = useMutation({
    mutationFn: async () => {
      const version = stamp();
      const changed = Object.entries(edits).filter(([key, html]) => html !== plain(...(key.split(':') as [Kind, Locale])));
      const blank = changed.filter(([, html]) => !html.trim()).map(([key]) => key);
      if (blank.length) {
        setEmpty(new Set(blank));
        throw new z.ZodError([]);
      }
      const ids: string[] = [];
      for (const [key, html] of changed) {
        const [kind, loc] = key.split(':');
        const body = legalDocumentBody.parse({ kind, locale: loc, version, html: textToHtml(html) });
        ids.push((await api.post<{ id: string }>('/legal-documents', body)).id);
      }
      // The first publish asks for the recent code; the rest follow it.
      const [first, ...rest] = ids;
      if (first) await run(() => api.post(`/legal-documents/${first}/publish`));
      for (const id of rest) await api.post(`/legal-documents/${id}/publish`);
    },
    onSuccess: () => {
      setEdits({});
      setEmpty(new Set());
      void qc.invalidateQueries({ queryKey: ['legal-current'] });
      onAnnounce(t('content.legal.published'));
    },
  });
  const dirty = Object.entries(edits).some(([key, html]) => html !== plain(...(key.split(':') as [Kind, Locale])));
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  return (
    <form
      noValidate
      className="flex flex-col gap-6"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        setEmpty(new Set());
        save.mutate();
      }}
    >
      <Banner tone="info">{t('content.legal.intro')}</Banner>
      <ErrorNote error={current.error} />
      <ErrorNote error={save.error instanceof MfaCancelled || save.error instanceof z.ZodError ? null : save.error} />
      <Tabs id="legal-kind" label={t('content.legal.title')} value={kind} onChange={setKind} tabs={KINDS.map((k) => ({ value: k, label: t(`content.legal.kinds.${k}`) }))} />
      <div {...tabPanelProps('legal-kind', kind)}>
        {current.isPending ? (
          <Spinner label={t('common:loading')} />
        ) : (
          <Section
            title={t(`content.legal.kinds.${kind}`)}
            description={saved(kind, locale)?.version ? t('content.legal.currentVersion', { version: saved(kind, locale)?.version }) : t('contentUx.noVersions')}
            actions={<Segmented hideLabel label={t('content.locale')} value={locale} onChange={setLocale} options={LOCALES.map((x) => ({ value: x, label: t(`lang.${x}`) }))} />}
          >
            <TextArea
              label={t('content.legal.text')}
              dir={dir}
              spellCheck={false}
              rows={16}
              hint={t('contentUx.textHint')}
              value={edits[slot(kind, locale)] ?? plain(kind, locale)}
              error={empty.has(slot(kind, locale)) ? t('content.legal.htmlInvalid') : undefined}
              onChange={(e) => setEdits({ ...edits, [slot(kind, locale)]: e.target.value })}
            />
          </Section>
        )}
      </div>
      <FormButtons onCancel={() => { setEdits({}); setEmpty(new Set()); }} busy={save.isPending} disabled={!dirty} label={t('content.legal.save')} />
    </form>
  );
}

function PushKeys() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['push-keys'], queryFn: () => api.get<PushKeyStatus>('/push-keys/status') });
  return (
    <Section
      title={
        <span className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-lg bg-canvas text-primary ring-1 ring-line">
            <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
          </span>
          <span>{t('content.push.title')}</span>
        </span>
      }
      description={t('content.push.viewOnly')}
      className="max-w-3xl"
    >
      <ErrorNote error={q.error} />
      {q.isPending ? (
        <Spinner label={t('common:loading')} />
      ) : (
        q.data && (
          <dl className="grid gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-2 rounded-xl border border-line bg-canvas/40 p-4">
              <dt className="text-xs font-semibold text-muted">{t('content.push.configured')}</dt>
              <dd className="pt-1">{q.data.configured ? <Pill tone="ok" className="shadow-xs">{t('yes')}</Pill> : <Pill tone="danger">{t('no')}</Pill>}</dd>
            </div>
            <div className="flex flex-col gap-1 rounded-xl border border-line bg-canvas/40 p-4">
              <dt className="text-xs font-semibold text-muted">{t('content.push.subscriptions')}</dt>
              <dd className="num font-display text-2xl font-bold text-ink">{q.data.activeSubscriptions}</dd>
            </div>
            <div className="flex min-w-0 flex-col gap-1.5 rounded-xl border border-line bg-canvas/40 p-4">
              <dt className="text-xs font-semibold text-muted">{t('content.push.fingerprint')}</dt>
              <dd>
                <code dir="ltr" className="block truncate rounded-md bg-canvas px-2.5 py-1 font-mono text-xs text-ink ring-1 ring-line">
                  {q.data.publicKeyFingerprint ?? '—'}
                </code>
              </dd>
            </div>
          </dl>
        )
      )}
    </Section>
  );
}
