import { ApiError } from '@dop/client-sdk';

// Client checks for the chime library upload (FR-SA-12, W11). The server repeats them and checks the MP3 itself.

export const CHIME_CODE = /^[a-z0-9-]{2,40}$/;
export const CHIME_MAX_BYTES = 512 * 1024;
/** Cannot be withdrawn: it is the fallback chime of every venue. */
export const DEFAULT_CHIME = 'classic';

export interface ChimeUploadInput {
  code: string;
  name: string;
  durationMs: string;
  file: File | null;
}
export type ChimeUploadErrors = Partial<Record<keyof ChimeUploadInput, string>>;

/** Validates the upload form; returns console i18n keys per field. */
export function validateChimeUpload(v: ChimeUploadInput): ChimeUploadErrors {
  const e: ChimeUploadErrors = {};
  if (!CHIME_CODE.test(v.code)) e.code = 'settings.chimeInvalid.code';
  const name = v.name.trim();
  if (!name || name.length > 80) e.name = 'settings.chimeInvalid.name';
  const ms = Number(v.durationMs);
  if (!/^\d+$/.test(v.durationMs) || ms < 100 || ms > 3000) e.durationMs = 'settings.chimeInvalid.durationMs';
  if (!v.file) e.file = 'settings.chimeInvalid.fileMissing';
  else if (v.file.size === 0 || v.file.size > CHIME_MAX_BYTES) e.file = 'settings.chimeInvalid.fileSize';
  else if (!/\.mp3$/i.test(v.file.name) && v.file.type !== 'audio/mpeg' && v.file.type !== 'audio/mp3') e.file = 'settings.chimeInvalid.fileType';
  return e;
}

/** Server field errors (a built-in code, the default chime) → i18n keys per form field. */
export function serverChimeErrors(e: unknown): ChimeUploadErrors {
  if (!(e instanceof ApiError)) return {};
  const f = e.fieldErrors();
  if (f.code) return { code: f.code === 'builtin' ? 'settings.chimeInvalid.builtin' : 'settings.chimeInvalid.code' };
  return {};
}
