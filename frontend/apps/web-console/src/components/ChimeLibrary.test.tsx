// @vitest-environment jsdom
import * as React from 'react';
// packages/ui has no tsconfig, so the root Vitest config compiles its JSX with the classic runtime.
(globalThis as { React?: unknown }).React = React;
import { ApiError } from '@dop/client-sdk';
import { initI18n } from '@dop/i18n';
import ar from '@dop/i18n/locales/ar/console.json';
import en from '@dop/i18n/locales/en/console.json';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { validateChimeUpload } from '../lib/chimes';
import { ChimeLibrary } from './ChimeLibrary';

// W11 / FR-SA-12: chime library upload, preview, rename and withdraw.
const get = vi.hoisted(() => vi.fn());
const patch = vi.hoisted(() => vi.fn());
const call = vi.hoisted(() => vi.fn());
vi.mock('../lib/api', () => ({ api: { get, patch, call } }));

const chimes = [
  { id: 'c1', code: 'classic', name: 'Classic', active: true, builtin: true, durationMs: 800, url: null },
  { id: 'c2', code: 'soft-bell', name: 'Soft bell', active: true, builtin: false, durationMs: 1200, url: 'https://cdn.example/chimes/soft-bell.mp3' },
];
const mp3 = (bytes = 1000, name = 'bell.mp3') => new File([new Uint8Array(bytes)], name, { type: 'audio/mpeg' });

const play = vi.fn(() => Promise.resolve());
const audioSrc: string[] = [];
class FakeAudio {
  constructor(src: string) {
    audioSrc.push(src);
  }
  play = play;
}

beforeAll(async () => {
  await initI18n('console', { ar, en }, 'en');
});
beforeEach(() => {
  get.mockReset().mockResolvedValue({ items: chimes });
  patch.mockReset().mockResolvedValue(undefined);
  call.mockReset();
  play.mockClear();
  audioSrc.length = 0;
  vi.stubGlobal('Audio', FakeAudio);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const renderLib = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ChimeLibrary />
    </QueryClientProvider>,
  );
const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

it('validates code, name, duration and the MP3 size', () => {
  expect(validateChimeUpload({ code: 'soft-bell', name: 'Soft', durationMs: '1200', file: mp3() })).toEqual({});
  const e = validateChimeUpload({ code: 'Bad Code', name: ' ', durationMs: '5000', file: mp3(600 * 1024) });
  expect(Object.keys(e).sort()).toEqual(['code', 'durationMs', 'file', 'name']);
  expect(validateChimeUpload({ code: 'ok', name: 'n', durationMs: '99', file: null }).file).toBe('settings.chimeInvalid.fileMissing');
  expect(validateChimeUpload({ code: 'ok', name: 'n', durationMs: '100', file: new File(['x'], 'a.wav', { type: 'audio/wav' }) }).file).toBe('settings.chimeInvalid.fileType');
});

it('lists chimes: built-ins are marked, uploaded ones preview their file', async () => {
  renderLib();
  await screen.findByText('Built-in (synthesised)');
  fireEvent.click(screen.getByRole('button', { name: 'Preview Soft bell' }));
  expect(audioSrc).toEqual(['https://cdn.example/chimes/soft-bell.mp3']);
  expect(play).toHaveBeenCalled();
  // The default chime cannot be withdrawn.
  expect((screen.getByLabelText('Offer Classic to venues') as HTMLInputElement).disabled).toBe(true);
});

it('renames and withdraws a chime with PATCH /chimes/:id', async () => {
  renderLib();
  const name = (await screen.findByLabelText('Name of chime soft-bell')) as HTMLInputElement;
  fireEvent.change(name, { target: { value: 'Gentle bell' } });
  const row = name.closest('tr')!;
  await act(async () => {
    fireEvent.click(row.querySelector('button[type="submit"]')!);
  });
  expect(patch).toHaveBeenCalledWith('/chimes/c2', { name: 'Gentle bell' });
  await act(async () => {
    fireEvent.click(screen.getByLabelText('Offer Soft bell to venues'));
  });
  expect(patch).toHaveBeenCalledWith('/chimes/c2', { active: false });
});

it('uploads the raw MP3 with PUT /chimes/:code and the name and length in the query', async () => {
  call.mockResolvedValue(chimes[1]);
  renderLib();
  await screen.findByText('Built-in (synthesised)');
  change('Code', 'door-bell');
  change('Name', 'Door bell');
  change('Length (milliseconds)', '900');
  const file = mp3();
  fireEvent.change(screen.getByLabelText('MP3 file'), { target: { files: [file] } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Upload chime' }));
  });
  expect(call).toHaveBeenCalledWith('PUT', '/chimes/door-bell', { query: { name: 'Door bell', durationMs: 900 }, raw: file, headers: { 'Content-Type': 'audio/mpeg' } });
  await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
});

it('shows client errors without calling the server, and the built-in error from the server', async () => {
  renderLib();
  await screen.findByText('Built-in (synthesised)');
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Upload chime' }));
  });
  expect(screen.getByText('Choose an MP3 file.')).toBeTruthy();
  expect(call).not.toHaveBeenCalled();

  call.mockRejectedValue(
    new ApiError(400, 'VALIDATION_FAILED', { type: 'x', title: 'x', status: 400, code: 'VALIDATION_FAILED', errors: [{ path: 'code', message: 'builtin' }] }),
  );
  change('Code', 'classic');
  change('Name', 'Mine');
  change('Length (milliseconds)', '900');
  fireEvent.change(screen.getByLabelText('MP3 file'), { target: { files: [mp3()] } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Upload chime' }));
  });
  await screen.findByText('This is a built-in chime and cannot be replaced. Choose another code.');
});
