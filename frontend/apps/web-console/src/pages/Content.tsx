import { emailTemplateBody, legalDocumentBody } from '@dop/contracts';
import { useTranslation } from '@dop/i18n';
import { Banner, Button, Card, Field, LiveRegion, Modal, PageShell, Select, Spinner } from '@dop/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { ErrorNote, FormButtons, Table, Td, TextArea } from '../components/common';
import { MfaCancelled, useFreshMfa } from '../components/FreshMfa';
import { api } from '../lib/api';
import { blocksToText, EMAIL_TEMPLATE_KEYS, placeholdersIn, textToBlocks } from '../lib/emailTemplates';
import type { PushKeyStatus } from '../lib/types';

// Legal documents, email texts and push key status (FR-SA-12, TR-PRV-09, TR-EML-03).

const LOCALES = ['ar', 'en'] as const;
const KINDS = legalDocumentBody.shape.kind.options;

export function ContentPage() {
  const { t } = useTranslation();
  const [announce, setAnnounce] = useState('');
  return (
    <PageShell title={t('content.title')}>
      <LiveRegion text={announce} />
      <div className="flex flex-col gap-8">
        <Legal onAnnounce={setAnnounce} />
        <EmailTemplates onAnnounce={setAnnounce} />
        <PushKeys />
      </div>
    </PageShell>
  );
}

interface Draft {
  id: string;
  kind: string;
  version: string;
  locale: string;
  published: boolean;
}

function Legal({ onAnnounce }: { onAnnounce: (s: string) => void }) {
  const { t } = useTranslation();
  const [v, setV] = useState({ kind: KINDS[0] as string, version: '', locale: 'ar', html: '' });
  const [errs, setErrs] = useState<{ version?: boolean; html?: boolean }>({});
  const qc = useQueryClient();
  const docs = useQuery({
    queryKey: ['legal-documents'],
    queryFn: () => api.get<{ items: Array<{ id: string; kind: string; version: string; locale: string; publishedAt: string | null }> }>('/legal-documents'),
  });
  const drafts: Draft[] = (docs.data?.items ?? []).map((d) => ({ id: d.id, kind: d.kind, version: d.version, locale: d.locale, published: d.publishedAt !== null }));
  const [publish, setPublish] = useState<Draft | null>(null);
  const run = useFreshMfa(); // publishing asks every tenant user to accept: the server asks for a recent code
  const create = useMutation({
    mutationFn: (body: unknown) => api.post<{ id: string }>('/legal-documents', body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['legal-documents'] });
      setV({ ...v, version: '', html: '' });
      onAnnounce(t('content.legal.created'));
    },
  });
  const pub = useMutation({
    mutationFn: (id: string) => run(() => api.post(`/legal-documents/${id}/publish`)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['legal-documents'] });
      setPublish(null);
      onAnnounce(t('content.legal.published'));
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const r = legalDocumentBody.safeParse({ ...v, version: v.version.trim() });
    const paths = new Set(r.success ? [] : r.error.issues.map((i) => i.path[0]));
    setErrs({ version: paths.has('version'), html: paths.has('html') });
    if (r.success) create.mutate(r.data);
  };
  return (
    <section aria-labelledby="legal-h">
      <h2 id="legal-h" className="mb-3 text-xl font-bold">
        {t('content.legal.title')}
      </h2>
      <Card>
        <p className="mb-3 text-sm text-muted">{t('content.legal.intro')}</p>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <ErrorNote error={create.error} />
          <div className="grid gap-3 sm:grid-cols-3">
            <Select label={t('content.legal.kind')} value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })} options={KINDS.map((k) => ({ value: k, label: t(`content.legal.kinds.${k}`) }))} />
            <Field label={t('content.legal.version')} dir="ltr" maxLength={20} placeholder="2026-10" value={v.version} error={errs.version ? t('content.legal.versionInvalid') : undefined} onChange={(e) => setV({ ...v, version: e.target.value })} />
            <Select label={t('content.locale')} value={v.locale} onChange={(e) => setV({ ...v, locale: e.target.value })} options={LOCALES.map((x) => ({ value: x, label: t(`lang.${x}`) }))} />
          </div>
          <TextArea
            label={t('content.legal.html')}
            dir={v.locale === 'ar' ? 'rtl' : 'ltr'}
            spellCheck={false}
            rows={12}
            value={v.html}
            error={errs.html ? t('content.legal.htmlInvalid') : undefined}
            onChange={(e) => setV({ ...v, html: e.target.value })}
          />
          <div className="flex justify-end">
            <Button type="submit" busy={create.isPending}>
              {t('content.legal.createDraft')}
            </Button>
          </div>
        </form>
        {drafts.length > 0 && (
          <div className="mt-4">
            <Table caption={t('content.legal.drafts')} head={[t('content.legal.kind'), t('content.legal.version'), t('content.locale'), t('content.legal.state'), '']}>
              {drafts.map((d) => (
                <tr key={d.id}>
                  <Td>{t(`content.legal.kinds.${d.kind}`, { defaultValue: d.kind })}</Td>
                  <Td>
                    <span dir="ltr">{d.version}</span>
                  </Td>
                  <Td>{d.locale}</Td>
                  <Td>{d.published ? t('content.legal.isPublished') : t('content.legal.isDraft')}</Td>
                  <Td>
                    {!d.published && (
                      <Button variant="secondary" onClick={() => setPublish(d)}>
                        {t('content.legal.publish')}
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          </div>
        )}
      </Card>
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
    </section>
  );
}

function EmailTemplates({ onAnnounce }: { onAnnounce: (s: string) => void }) {
  const { t } = useTranslation();
  const [key, setKey] = useState<string>(EMAIL_TEMPLATE_KEYS[0]);
  const [locale, setLocale] = useState<string>('en');
  return (
    <section aria-labelledby="email-h">
      <h2 id="email-h" className="mb-3 text-xl font-bold">
        {t('content.email.title')}
      </h2>
      <Card>
        <p className="mb-3 text-sm text-muted">{t('content.email.intro')}</p>
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <Select label={t('content.email.template')} value={key} onChange={(e) => setKey(e.target.value)} options={EMAIL_TEMPLATE_KEYS.map((k) => ({ value: k, label: k }))} />
          <Select label={t('content.locale')} value={locale} onChange={(e) => setLocale(e.target.value)} options={LOCALES.map((x) => ({ value: x, label: t(`lang.${x}`) }))} />
        </div>
        <TemplateEditor key={`${key}:${locale}`} templateKey={key} locale={locale} onSaved={() => onAnnounce(t('content.email.saved'))} />
      </Card>
    </section>
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
  const blocks = textToBlocks(text).length;
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      {initial.subject === null && <Banner tone="info">{t('content.email.usingDefault')}</Banner>}
      <ErrorNote error={save.error instanceof MfaCancelled ? null : save.error} />
      <Field label={t('content.email.subject')} dir={dir} maxLength={200} value={subject} error={errs.subject ? t('content.email.subjectInvalid') : undefined} onChange={(e) => setSubject(e.target.value)} />
      <TextArea
        label={t('content.email.blocks')}
        dir={dir}
        rows={12}
        hint={t('content.email.blocksHint', { count: blocks })}
        value={text}
        error={errs.blocks ? t('content.email.blocksInvalid') : undefined}
        onChange={(e) => setText(e.target.value)}
      />
      <p className="text-sm text-muted">
        {t('content.email.placeholders')}{' '}
        {placeholders.length ? (
          placeholders.map((p) => (
            <code key={p} dir="ltr" className="me-2 rounded bg-canvas px-1">
              {`{{${p}}}`}
            </code>
          ))
        ) : (
          <span>—</span>
        )}
      </p>
      <div className="flex justify-end">
        <Button type="submit" busy={save.isPending}>
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
    <section aria-labelledby="push-h">
      <h2 id="push-h" className="mb-3 text-xl font-bold">
        {t('content.push.title')}
      </h2>
      <Card>
        <ErrorNote error={q.error} />
        {q.isPending ? (
          <Spinner label={t('common:loading')} />
        ) : (
          q.data && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
              <dt className="font-medium text-muted">{t('content.push.configured')}</dt>
              <dd>{q.data.configured ? `✓ ${t('yes')}` : `✗ ${t('no')}`}</dd>
              <dt className="font-medium text-muted">{t('content.push.fingerprint')}</dt>
              <dd>
                <code dir="ltr">{q.data.publicKeyFingerprint ?? '—'}</code>
              </dd>
              <dt className="font-medium text-muted">{t('content.push.subscriptions')}</dt>
              <dd className="num">{q.data.activeSubscriptions}</dd>
            </dl>
          )
        )}
        <p className="mt-3 text-sm text-muted">{t('content.push.viewOnly')}</p>
      </Card>
    </section>
  );
}
