import { ApiError } from '@dop/client-sdk';
import { useTranslation } from '@dop/i18n';
import { Button, Card, Field, LiveRegion, Spinner } from '@dop/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { DEFAULT_CHIME, serverChimeErrors, validateChimeUpload, type ChimeUploadErrors, type ChimeUploadInput } from '../lib/chimes';
import { errorText } from '../lib/errors';
import type { Chime } from '../lib/types';
import { Checkbox, ErrorNote, Table, Td } from './common';

// Chime library (FR-SA-12, W11): built-in chimes are synthesised on devices; uploaded ones are MP3 files.
// Upload: PUT /chimes/:code with the raw MP3 body; rename and withdraw: PATCH /chimes/:id.

export function ChimeLibrary() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [announce, setAnnounce] = useState('');
  const q = useQuery({ queryKey: ['chimes'], queryFn: () => api.get<{ items: Chime[] }>('/chimes') });
  const patch = useMutation({
    mutationFn: (v: { id: string; body: { name?: string; active?: boolean } }) => api.patch(`/chimes/${encodeURIComponent(v.id)}`, v.body),
    onSuccess: () => {
      setAnnounce(t('common:saved'));
      void qc.invalidateQueries({ queryKey: ['chimes'] });
    },
  });
  const patchError = patch.error instanceof ApiError && patch.error.problem?.detail ? `${errorText(t, patch.error)} ${patch.error.problem.detail}` : null;
  return (
    <section aria-labelledby="chime-h">
      <LiveRegion text={announce} />
      <h2 id="chime-h" className="mb-3 text-xl font-bold">
        {t('settings.chimes')}
      </h2>
      <ErrorNote error={q.error} />
      {patch.error ? (
        <p role="alert" className="mb-3 rounded-input bg-danger-bg px-3 py-2 font-medium text-danger">
          {patchError ?? errorText(t, patch.error)}
        </p>
      ) : null}
      {q.isPending ? (
        <Spinner label={t('common:loading')} />
      ) : (
        <Table caption={t('settings.chimes')} head={[t('settings.code'), t('settings.chimeName'), t('settings.duration'), t('settings.preview'), t('settings.active')]}>
          {q.data?.items.map((c) => (
            <tr key={c.id}>
              <Td>
                <code dir="ltr">{c.code}</code>
              </Td>
              <Td>
                <ChimeRename chime={c} busy={patch.isPending} onSave={(name) => patch.mutate({ id: c.id, body: { name } })} />
              </Td>
              <Td className="num">{(c.durationMs / 1000).toFixed(1)} s</Td>
              <Td>{c.builtin || !c.url ? <span className="text-muted">{t('settings.builtinChime')}</span> : <ChimePreview chime={c} />}</Td>
              <Td>
                <Checkbox
                  label={t('settings.chimeActiveFor', { name: c.name })}
                  checked={c.active}
                  disabled={patch.isPending || (c.code === DEFAULT_CHIME && c.active)}
                  hint={c.code === DEFAULT_CHIME ? t('settings.chimeDefault') : undefined}
                  onChange={(e) => patch.mutate({ id: c.id, body: { active: e.target.checked } })}
                />
              </Td>
            </tr>
          ))}
        </Table>
      )}
      <ChimeUpload
        onDone={(name) => {
          setAnnounce(t('settings.chimeUploaded', { name }));
          void qc.invalidateQueries({ queryKey: ['chimes'] });
        }}
      />
    </section>
  );
}

function ChimePreview({ chime }: { chime: Chime }) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  const play = () => {
    setFailed(false);
    try {
      void new Audio(chime.url ?? '').play().catch(() => setFailed(true));
    } catch {
      setFailed(true);
    }
  };
  return (
    <div className="flex flex-col gap-1">
      <Button type="button" variant="secondary" onClick={play} aria-label={t('settings.previewChime', { name: chime.name })}>
        <span aria-hidden="true">▶ </span>
        {t('settings.preview')}
      </Button>
      {failed && (
        <span role="alert" className="text-sm text-danger">
          {t('settings.previewFailed')}
        </span>
      )}
    </div>
  );
}

function ChimeRename({ chime, busy, onSave }: { chime: Chime; busy: boolean; onSave: (name: string) => void }) {
  const { t } = useTranslation();
  const [v, setV] = useState(chime.name);
  const trimmed = v.trim();
  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (trimmed && trimmed !== chime.name) onSave(trimmed);
      }}
    >
      <Field label={t('settings.chimeNameFor', { code: chime.code })} className="[&>label]:sr-only" maxLength={80} value={v} onChange={(e) => setV(e.target.value)} />
      <Button type="submit" variant="secondary" disabled={busy || !trimmed || trimmed === chime.name}>
        {t('settings.rename')}
      </Button>
    </form>
  );
}

const EMPTY_UPLOAD: ChimeUploadInput = { code: '', name: '', durationMs: '', file: null };

function ChimeUpload({ onDone }: { onDone: (name: string) => void }) {
  const { t } = useTranslation();
  const [v, setV] = useState<ChimeUploadInput>(EMPTY_UPLOAD);
  const [errors, setErrors] = useState<ChimeUploadErrors>({});
  const [fileKey, setFileKey] = useState(0);
  const up = useMutation({
    mutationFn: (x: { code: string; name: string; durationMs: number; file: File }) =>
      api.call<Chime>('PUT', `/chimes/${encodeURIComponent(x.code)}`, {
        query: { name: x.name, durationMs: x.durationMs },
        raw: x.file,
        headers: { 'Content-Type': 'audio/mpeg' },
      }),
    onSuccess: (_r, x) => {
      setV(EMPTY_UPLOAD);
      setErrors({});
      setFileKey((k) => k + 1);
      onDone(x.name);
    },
    onError: (e) => setErrors(serverChimeErrors(e)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs = validateChimeUpload(v);
    setErrors(errs);
    if (Object.keys(errs).length || !v.file) return;
    up.mutate({ code: v.code, name: v.name.trim(), durationMs: Number(v.durationMs), file: v.file });
  };
  const err = (k: keyof ChimeUploadInput) => {
    const key = errors[k];
    return key ? t(key) : undefined;
  };
  return (
    <Card className="mt-4">
      <h3 className="mb-1 text-lg font-bold">{t('settings.chimeUpload')}</h3>
      <p className="mb-3 text-sm text-muted">{t('settings.chimeUploadHint')}</p>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2" noValidate>
        {up.error ? (
          <div className="sm:col-span-2">
            <ErrorNote error={up.error} />
          </div>
        ) : null}
        <Field label={t('settings.chimeCode')} dir="ltr" autoComplete="off" maxLength={40} hint={t('settings.chimeCodeHint')} error={err('code')} value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} />
        <Field label={t('settings.chimeName')} maxLength={80} error={err('name')} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
        <Field
          label={t('settings.chimeDurationMs')}
          type="number"
          inputMode="numeric"
          min={100}
          max={3000}
          dir="ltr"
          hint={t('settings.chimeDurationHint')}
          error={err('durationMs')}
          value={v.durationMs}
          onChange={(e) => setV({ ...v, durationMs: e.target.value })}
        />
        <Field
          key={fileKey}
          label={t('settings.chimeFile')}
          type="file"
          accept="audio/mpeg,.mp3"
          hint={t('settings.chimeFileHint')}
          error={err('file')}
          onChange={(e) => setV({ ...v, file: e.target.files?.[0] ?? null })}
        />
        <div className="flex justify-end sm:col-span-2">
          <Button type="submit" busy={up.isPending}>
            {t('settings.chimeUploadSubmit')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
