import { emailTemplateBody, legalDocumentBody } from '@dop/contracts';
import { useTranslation } from '@dop/i18n';
import { Banner, Button, EmptyState, Field, LiveRegion, Modal, PageShell, Pill, Select, Spinner } from '@dop/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { ErrorNote, FormButtons, Section, Segmented, tabPanelProps, Tabs, TextArea } from '../components/common';
import { MfaCancelled, useFreshMfa } from '../components/FreshMfa';
import { api } from '../lib/api';
import { blocksToText, EMAIL_TEMPLATE_KEYS, placeholdersIn, textToBlocks } from '../lib/emailTemplates';
import { fmtDate } from '../lib/format';
import type { PushKeyStatus } from '../lib/types';

// Legal documents, email texts and push key status (FR-SA-12, TR-PRV-09, TR-EML-03).

const LOCALES = ['ar', 'en'] as const;
const KINDS = legalDocumentBody.shape.kind.options;
type Tab = 'legal' | 'email' | 'push';

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
            value: 'email',
            label: t('content.email.title'),
            icon: (
              <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
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
      <div {...tabPanelProps('content', 'email')} hidden={tab !== 'email'}>
        <EmailTemplates onAnnounce={setAnnounce} />
      </div>
      {tab === 'push' && (
        <div {...tabPanelProps('content', 'push')}>
          <PushKeys />
        </div>
      )}
    </PageShell>
  );
}

interface Doc {
  id: string;
  kind: string;
  version: string;
  locale: string;
  publishedAt: string | null;
}

function Legal({ onAnnounce }: { onAnnounce: (s: string) => void }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [publish, setPublish] = useState<Doc | null>(null);
  const docs = useQuery({ queryKey: ['legal-documents'], queryFn: () => api.get<{ items: Doc[] }>('/legal-documents') });
  const run = useFreshMfa(); // publishing asks every tenant user to accept: the server asks for a recent code
  const pub = useMutation({
    mutationFn: (id: string) => run(() => api.post(`/legal-documents/${id}/publish`)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['legal-documents'] });
      setPublish(null);
      onAnnounce(t('content.legal.published'));
    },
  });
  const items = docs.data?.items ?? [];
  // The current version of a kind and language is its most recently published one.
  const current = new Set(
    KINDS.flatMap((k) => LOCALES.map((l) => items.filter((d) => d.kind === k && d.locale === l && d.publishedAt).sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))[0]?.id)),
  );
  return (
    <div className="flex flex-col gap-6">
      <Banner tone="info">{t('content.legal.intro')}</Banner>
      <div className="flex justify-end">
        {!creating && (
          <Button onClick={() => setCreating(true)}>
            <span aria-hidden="true">+</span>
            {t('contentUx.newDraft')}
          </Button>
        )}
      </div>
      {creating && (
        <DraftForm
          onCancel={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            void qc.invalidateQueries({ queryKey: ['legal-documents'] });
            onAnnounce(t('content.legal.created'));
          }}
        />
      )}
      <ErrorNote error={docs.error} />
      {docs.isPending ? (
        <Spinner label={t('common:loading')} />
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {KINDS.map((k) => {
            const list = items.filter((d) => d.kind === k).sort((a, b) => b.version.localeCompare(a.version) || a.locale.localeCompare(b.locale));
            return (
              <Section key={k} title={t(`content.legal.kinds.${k}`)}>
                {list.length === 0 ? (
                  <p className="text-sm text-muted">{t('contentUx.noVersions')}</p>
                ) : (
                  <ul className="flex flex-col divide-y divide-line">
                    {list.map((d) => (
                      <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                        <span className="flex min-w-0 flex-wrap items-center gap-2.5">
                          <span dir="ltr" className="inline-flex items-center rounded-md bg-canvas px-2.5 py-1 font-mono text-xs font-bold text-ink ring-1 ring-line">
                            {d.version}
                          </span>
                          <span className="rounded-full bg-canvas/60 px-2 py-0.5 text-xs font-semibold text-muted ring-1 ring-line/50">
                            {t(`lang.${d.locale}`, { defaultValue: d.locale })}
                          </span>
                          {current.has(d.id) ? (
                            <Pill tone="ok" className="shadow-xs">
                              {t('contentUx.current')}
                            </Pill>
                          ) : d.publishedAt ? (
                            <Pill>{t('content.legal.isPublished')}</Pill>
                          ) : (
                            <Pill tone="warn">{t('content.legal.isDraft')}</Pill>
                          )}
                        </span>
                        {d.publishedAt ? (
                          <span className="inline-flex items-center gap-1.5 text-xs text-muted">
                            <svg aria-hidden="true" className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                            {fmtDate(d.publishedAt, i18n.language)}
                          </span>
                        ) : (
                          <Button variant="secondary" onClick={() => setPublish(d)}>
                            {t('content.legal.publish')}
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            );
          })}
        </div>
      )}
      {publish && (
        <Modal open onOpenChange={(o) => !o && setPublish(null)} title={t('content.legal.publishTitle')} description={t('content.legal.publishBody', { kind: t(`content.legal.kinds.${publish.kind}`), version: publish.version })}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              pub.mutate(publish.id);
            }}
            className="flex flex-col gap-4"
          >
            <ErrorNote error={pub.error instanceof MfaCancelled ? null : pub.error} />
            <FormButtons onCancel={() => setPublish(null)} busy={pub.isPending} label={t('content.legal.publish')} />
          </form>
        </Modal>
      )}
    </div>
  );
}

function DraftForm({ onCancel, onDone }: { onCancel: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const [v, setV] = useState({ kind: KINDS[0] as string, version: '', locale: 'ar', html: '' });
  const [view, setView] = useState<'write' | 'preview'>('write');
  const [errs, setErrs] = useState<{ version?: boolean; html?: boolean }>({});
  const create = useMutation({ mutationFn: (body: unknown) => api.post<{ id: string }>('/legal-documents', body), onSuccess: onDone });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const r = legalDocumentBody.safeParse({ ...v, version: v.version.trim() });
    const paths = new Set(r.success ? [] : r.error.issues.map((i) => i.path[0]));
    setErrs({ version: paths.has('version'), html: paths.has('html') });
    if (r.success) create.mutate(r.data);
  };
  const dir = v.locale === 'ar' ? 'rtl' : 'ltr';
  return (
    <Section title={t('contentUx.newDraft')} description={t('contentUx.draftIntro')}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <ErrorNote error={create.error} />
        <div className="grid gap-3 sm:grid-cols-3">
          <Select label={t('content.legal.kind')} value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })} options={KINDS.map((k) => ({ value: k, label: t(`content.legal.kinds.${k}`) }))} />
          <Field label={t('content.legal.version')} dir="ltr" maxLength={20} placeholder="2026-10" hint={t('contentUx.versionHint')} value={v.version} error={errs.version ? t('content.legal.versionInvalid') : undefined} onChange={(e) => setV({ ...v, version: e.target.value })} />
          <Select label={t('content.locale')} value={v.locale} onChange={(e) => setV({ ...v, locale: e.target.value })} options={LOCALES.map((x) => ({ value: x, label: t(`lang.${x}`) }))} />
        </div>
        <Segmented
          label={t('content.legal.html')}
          value={view}
          onChange={setView}
          options={[
            { value: 'write', label: t('contentUx.write') },
            { value: 'preview', label: t('contentUx.preview') },
          ]}
        />
        {view === 'write' ? (
          <TextArea
            label={t('content.legal.html')}
            dir={dir}
            spellCheck={false}
            rows={14}
            hint={t('contentUx.htmlHint')}
            value={v.html}
            error={errs.html ? t('content.legal.htmlInvalid') : undefined}
            onChange={(e) => setV({ ...v, html: e.target.value })}
          />
        ) : v.html.trim() ? (
          // Sandboxed with no permissions: the draft's HTML cannot run scripts or reach the console.
          <iframe title={t('contentUx.preview')} sandbox="" srcDoc={`<!doctype html><html dir="${dir}"><body style="font-family:system-ui,sans-serif;line-height:1.6;padding:16px">${v.html}</body></html>`} className="h-96 w-full rounded-input border border-line bg-surface" />
        ) : (
          <EmptyState title={t('contentUx.previewEmpty')} />
        )}
        <FormButtons onCancel={onCancel} busy={create.isPending} label={t('content.legal.createDraft')} />
      </form>
    </Section>
  );
}

function EmailTemplates({ onAnnounce }: { onAnnounce: (s: string) => void }) {
  const { t } = useTranslation();
  const [key, setKey] = useState<string>(EMAIL_TEMPLATE_KEYS[0]);
  const [locale, setLocale] = useState<(typeof LOCALES)[number]>('en');
  const [filter, setFilter] = useState('');
  const name = (k: string) => t(`contentUx.emailNames.${k}`, { defaultValue: k });
  const shown = EMAIL_TEMPLATE_KEYS.filter((k) => !filter.trim() || `${name(k)} ${k}`.toLowerCase().includes(filter.trim().toLowerCase()));
  return (
    <div className="flex flex-col gap-4">
      <Banner tone="info">{t('content.email.intro')}</Banner>
      <div className="grid items-start gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <nav aria-label={t('content.email.template')} className="flex flex-col gap-2 rounded-[var(--radius-card)] bg-surface p-3 shadow-card lg:sticky lg:top-6">
          <Field label={t('contentUx.findEmail')} type="search" value={filter} onChange={(e) => setFilter(e.target.value)} className="[&>label]:sr-only" placeholder={t('contentUx.findEmail')} />
          {/* Stacked above the editor on narrow screens, so the list scrolls in a shorter box there. */}
          <ul className="flex max-h-64 flex-col gap-0.5 overflow-auto lg:max-h-[60vh]">
            {shown.map((k) => (
              <li key={k}>
                <button
                  type="button"
                  aria-current={k === key ? 'true' : undefined}
                  onClick={() => setKey(k)}
                  className={`flex min-h-11 w-full flex-col items-start justify-center rounded-input px-3 py-1.5 text-start text-sm transition-colors ${k === key ? 'bg-ink text-white' : 'text-ink-2 hover:bg-canvas hover:text-ink'}`}
                >
                  <span className="max-w-full font-semibold break-words">{name(k)}</span>
                  <span dir="ltr" className={`max-w-full font-mono text-[0.6875rem] break-all ${k === key ? 'text-white/60' : 'text-muted'}`}>
                    {k}
                  </span>
                </button>
              </li>
            ))}
            {shown.length === 0 && <li className="px-3 py-2 text-sm text-muted">{t('picker.noResults')}</li>}
          </ul>
        </nav>
        <Section
          title={name(key)}
          actions={<Segmented label={t('content.locale')} hideLabel value={locale} onChange={setLocale} options={LOCALES.map((x) => ({ value: x, label: t(`lang.${x}`) }))} />}
        >
          <TemplateEditor key={`${key}:${locale}`} templateKey={key} locale={locale} onSaved={() => onAnnounce(t('content.email.saved'))} />
        </Section>
      </div>
    </div>
  );
}

function TemplateEditor({ templateKey, locale, onSaved }: { templateKey: string; locale: string; onSaved: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const path = `/email-templates/${encodeURIComponent(templateKey)}/${encodeURIComponent(locale)}`;
  const q = useQuery({ queryKey: ['email-template', templateKey, locale], queryFn: () => api.get<{ subject: string | null; blocks: string[] }>(path) });
  if (q.isPending) return <Spinner label={t('common:loading')} />;
  if (q.error) return <ErrorNote error={q.error} />;
  return (
    <TemplateForm
      path={path}
      locale={locale}
      initial={q.data}
      onSaved={() => {
        onSaved();
        void qc.invalidateQueries({ queryKey: ['email-template', templateKey, locale] });
      }}
    />
  );
}

function TemplateForm({ path, locale, initial, onSaved }: { path: string; locale: string; initial: { subject: string | null; blocks: string[] }; onSaved: () => void }) {
  const { t } = useTranslation();
  const [subject, setSubject] = useState(initial.subject ?? '');
  const [text, setText] = useState(blocksToText(initial.blocks ?? []));
  const [errs, setErrs] = useState<{ subject?: boolean; blocks?: boolean }>({});
  const run = useFreshMfa(); // email texts reach every user (password resets too): the server asks for a recent code
  const save = useMutation({ mutationFn: (body: unknown) => run(() => api.put(path, body)), onSuccess: onSaved });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const r = emailTemplateBody.safeParse({ subject: subject.trim(), blocks: textToBlocks(text) });
    const paths = new Set(r.success ? [] : r.error.issues.map((i) => i.path[0]));
    setErrs({ subject: paths.has('subject'), blocks: paths.has('blocks') });
    if (r.success) save.mutate(r.data);
  };
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  const placeholders = placeholdersIn(`${subject}\n${text}`);
  // Placeholders the saved text uses that the draft has lost: the sent email would miss that detail.
  const lost = placeholdersIn(`${initial.subject ?? ''}\n${blocksToText(initial.blocks ?? [])}`).filter((p) => !placeholders.includes(p));
  const blocks = textToBlocks(text);
  const dirty = subject !== (initial.subject ?? '') || text !== blocksToText(initial.blocks ?? []);
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      {initial.subject === null && <Banner tone="info">{t('content.email.usingDefault')}</Banner>}
      <ErrorNote error={save.error instanceof MfaCancelled ? null : save.error} />
      <Field label={t('content.email.subject')} dir={dir} maxLength={200} value={subject} error={errs.subject ? t('content.email.subjectInvalid') : undefined} onChange={(e) => setSubject(e.target.value)} />
      <TextArea
        label={t('content.email.blocks')}
        dir={dir}
        rows={12}
        hint={t('content.email.blocksHint', { count: blocks.length })}
        className="min-h-60 rounded-input border border-line bg-surface p-3 text-base leading-relaxed"
        value={text}
        error={errs.blocks ? t('content.email.blocksInvalid') : undefined}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <span className="text-muted">{t('content.email.placeholders')}</span>
        {placeholders.length ? (
          placeholders.map((p) => (
            <code key={p} dir="ltr" className="rounded-full bg-canvas px-2.5 py-0.5 text-xs ring-1 ring-line">
              {`{{${p}}}`}
            </code>
          ))
        ) : (
          <span>—</span>
        )}
      </div>
      {lost.length > 0 && <Banner tone="warn">{t('contentUx.lostPlaceholders', { list: lost.map((p) => `{{${p}}}`).join(', ') })}</Banner>}
      <details className="rounded-input border border-line">
        <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-semibold">{t('contentUx.emailPreview')}</summary>
        <div lang={locale} dir={dir} className="flex flex-col gap-3 border-t border-line bg-canvas p-4">
          <p className="font-semibold">{subject || '—'}</p>
          {blocks.map((b, i) => (
            <p key={i} className="whitespace-pre-line text-ink-2">
              {b}
            </p>
          ))}
        </div>
      </details>
      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-line pt-4">
        {dirty && <span className="me-auto text-sm font-semibold text-warn">{t('settingsForm.unsaved', { count: 1 })}</span>}
        <Button type="submit" busy={save.isPending} disabled={!dirty}>
          {t('common:save')}
        </Button>
      </div>
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
