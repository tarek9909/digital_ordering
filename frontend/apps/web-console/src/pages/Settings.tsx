import { ApiError } from '@dop/client-sdk';
import { useTranslation } from '@dop/i18n';
import { Button, Card, Field, LiveRegion, PageShell, Spinner } from '@dop/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ChimeLibrary } from '../components/ChimeLibrary';
import { Checkbox, ErrorNote, Table, Td } from '../components/common';
import { TextArea } from '../components/common';
import { MfaCancelled, useFreshMfa } from '../components/FreshMfa';
import { api } from '../lib/api';
import { errorText } from '../lib/errors';
import { fmtDate } from '../lib/format';
import { parseSettingJson, prettyJson } from '../lib/settingJson';
import type { Language, SettingRow } from '../lib/types';

// Platform settings as JSON (appendix 30.4), languages and the chime library (FR-SA-09 – FR-SA-12).

export function SettingsPage() {
  const { t } = useTranslation();
  const [announce, setAnnounce] = useState('');
  return (
    <PageShell title={t('settings.title')}>
      <LiveRegion text={announce} />
      <div className="flex flex-col gap-8">
        <PlatformSettings onSaved={(k) => setAnnounce(t('settings.savedKey', { key: k }))} />
        <Languages onSaved={() => setAnnounce(t('common:saved'))} />
        <ChimeLibrary />
      </div>
    </PageShell>
  );
}

function PlatformSettings({ onSaved }: { onSaved: (key: string) => void }) {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['settings'], queryFn: () => api.get<{ items: SettingRow[] }>('/settings') });
  // Website settings (`site.*`) are edited on the Website page; the others use the JSON editor.
  return (
    <section aria-labelledby="ps-h">
      <h2 id="ps-h" className="mb-3 text-xl font-bold">
        {t('settings.platform')}
      </h2>
      <ErrorNote error={q.error} />
      {q.isPending ? (
        <Spinner label={t('common:loading')} />
      ) : (
        <div className="flex flex-col gap-6">
          <div className="grid gap-4 lg:grid-cols-2">{q.data?.items.filter((s) => !s.key.startsWith('site.')).map((s) => <SettingEditor key={s.key} row={s} onSaved={onSaved} />)}</div>
        </div>
      )}
    </section>
  );
}

function SettingEditor({ row, onSaved }: { row: SettingRow; onSaved: (key: string) => void }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const [text, setText] = useState(() => prettyJson(row.value));
  const [error, setError] = useState<string | undefined>();
  const run = useFreshMfa();
  // Platform settings need a recent second factor (L-6).
  const save = useMutation({
    mutationFn: (value: unknown) => run(() => api.put(`/settings/${encodeURIComponent(row.key)}`, { value })),
    onSuccess: () => {
      onSaved(row.key);
      void qc.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (e) => !(e instanceof MfaCancelled) && setError(e instanceof ApiError && e.problem?.detail ? `${errorText(t, e)} ${e.problem.detail}` : errorText(t, e)),
  });
  const submit = () => {
    const r = parseSettingJson(text, row.value);
    if (!r.ok) {
      setError(r.error === 'syntax' ? t('settings.invalidJson', { detail: r.detail ?? '' }) : t('settings.wrongShape', { expected: t(`settings.kind.${r.expected}`) }));
      return;
    }
    setError(undefined);
    save.mutate(r.value);
  };
  const dirty = text !== prettyJson(row.value);
  return (
    <Card>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex flex-col gap-2"
        noValidate
      >
        <TextArea
          label={row.key}
          dir="ltr"
          spellCheck={false}
          rows={Math.min(14, Math.max(3, text.split('\n').length))}
          value={text}
          error={error}
          hint={row.updatedAt ? t('settings.updatedAt', { date: fmtDate(row.updatedAt, i18n.language) }) : t('settings.default')}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            disabled={!dirty}
            onClick={() => {
              setText(prettyJson(row.value));
              setError(undefined);
            }}
          >
            {t('settings.revert')}
          </Button>
          <Button type="submit" disabled={!dirty} busy={save.isPending}>
            {t('common:save')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function Languages({ onSaved }: { onSaved: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['languages'], queryFn: () => api.get<{ items: Language[] }>('/languages') });
  const patch = useMutation({
    mutationFn: (v: { code: string; body: { customerEnabled?: boolean; ttsLang?: string | null } }) => api.patch(`/languages/${encodeURIComponent(v.code)}`, v.body),
    onSuccess: () => {
      onSaved();
      void qc.invalidateQueries({ queryKey: ['languages'] });
    },
  });
  return (
    <section aria-labelledby="lang-h">
      <h2 id="lang-h" className="mb-3 text-xl font-bold">
        {t('settings.languages')}
      </h2>
      <ErrorNote error={q.error ?? patch.error} />
      {q.isPending ? (
        <Spinner label={t('common:loading')} />
      ) : (
        <Table caption={t('settings.languages')} head={[t('settings.code'), t('settings.langName'), t('settings.direction'), t('settings.customerEnabled'), t('settings.tts')]}>
          {q.data?.items.map((l) => (
            <tr key={l.code}>
              <Td>
                <code dir="ltr">{l.code}</code>
              </Td>
              <Td>{l.name}</Td>
              <Td>{l.direction === 'rtl' ? t('settings.rtl') : t('settings.ltr')}</Td>
              <Td>
                <Checkbox
                  label={t('settings.enabledFor', { name: l.name })}
                  checked={Boolean(l.customer_enabled)}
                  disabled={patch.isPending}
                  onChange={(e) => patch.mutate({ code: l.code, body: { customerEnabled: e.target.checked } })}
                />
              </Td>
              <Td>
                <TtsEditor lang={l} busy={patch.isPending} onSave={(v) => patch.mutate({ code: l.code, body: { ttsLang: v } })} />
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </section>
  );
}

function TtsEditor({ lang, busy, onSave }: { lang: Language; busy: boolean; onSave: (v: string | null) => void }) {
  const { t } = useTranslation();
  const [v, setV] = useState(lang.tts_lang ?? '');
  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(v.trim() || null);
      }}
    >
      <Field label={t('settings.ttsFor', { name: lang.name })} className="[&>label]:sr-only" dir="ltr" maxLength={10} value={v} onChange={(e) => setV(e.target.value)} />
      <Button type="submit" variant="secondary" disabled={busy || v === (lang.tts_lang ?? '')}>
        {t('common:save')}
      </Button>
    </form>
  );
}
