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
      <LiveRegion text={announce} />
      <Tabs
        id="content"
        label={t('content.title')}
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'legal', label: t('content.legal.title') },
          { value: 'email', label: t('content.email.title') },
          { value: 'push', label: t('content.push.title') },
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
                      <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0">
                        <span className="flex flex-wrap items-center gap-2">
                          <span dir="ltr" className="font-mono text-sm font-semibold">
                            {d.version}
                          </span>
                          <span className="text-sm text-muted">{t(`lang.${d.locale}`, { defaultValue: d.locale })}</span>
                          {current.has(d.id) ? <Pill tone="ok">{t('contentUx.current')}</Pill> : d.publishedAt ? <Pill>{t('content.legal.isPublished')}</Pill> : <Pill tone="warn">{t('content.legal.isDraft')}</Pill>}
                        </span>
                        {d.publishedAt ? (
                          <span className="text-xs text-muted">{fmtDate(d.publishedAt, i18n.language)}</span>
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
          <ul className="flex max-h-[60vh] flex-col gap-0.5 overflow-auto">
            {shown.map((k) => (
              <li key={k}>
                <button
                  type="button"
                  aria-current={k === key ? 'true' : undefined}
                  onClick={() => setKey(k)}
                  className={`flex min-h-11 w-full flex-col items-start justify-center rounded-input px-3 py-1.5 text-start text-sm transition-colors ${k === key ? 'bg-ink text-white' : 'text-ink-2 hover:bg-canvas hover:text-ink'}`}
                >
                  <span className="font-semibold">{name(k)}</span>
                  <span dir="ltr" className={`font-mono text-[0.6875rem] ${k === key ? 'text-white/60' : 'text-muted'}`}>
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
      <div className="flex items-center justify-end gap-3 border-t border-line pt-4">
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
    <Section title={t('content.push.title')} description={t('content.push.viewOnly')} className="max-w-2xl">
      <ErrorNote error={q.error} />
      {q.isPending ? (
        <Spinner label={t('common:loading')} />
      ) : (
        q.data && (
          <dl className="grid gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1 rounded-input bg-canvas p-3">
              <dt className="text-xs text-muted">{t('content.push.configured')}</dt>
              <dd>{q.data.configured ? <Pill tone="ok">{t('yes')}</Pill> : <Pill tone="danger">{t('no')}</Pill>}</dd>
            </div>
            <div className="flex flex-col gap-1 rounded-input bg-canvas p-3">
              <dt className="text-xs text-muted">{t('content.push.subscriptions')}</dt>
              <dd className="num font-display text-xl font-bold">{q.data.activeSubscriptions}</dd>
            </div>
            <div className="flex min-w-0 flex-col gap-1 rounded-input bg-canvas p-3">
              <dt className="text-xs text-muted">{t('content.push.fingerprint')}</dt>
              <dd>
                <code dir="ltr" className="block truncate text-xs">
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
