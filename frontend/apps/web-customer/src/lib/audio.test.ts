// @vitest-environment jsdom
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { startAlertLoop, testChime, unlockAudio } from './audio';

// W11: the live alert loop and the activation test chime play the venue's chime.
const play = vi.hoisted(() => vi.fn(async () => 'classic'));
vi.mock('@dop/client-sdk', () => ({ playVenueChime: play }));

beforeAll(async () => {
  class FakeAC {
    state = 'suspended';
    async resume() {
      this.state = 'running';
    }
  }
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeAC;
  expect(await unlockAudio()).toBe(true);
});
afterEach(() => play.mockClear());

it('the test chime uses the venue chime source', async () => {
  const venue = { chime: 'bell', chimeUrl: null };
  await testChime(venue);
  expect(play).toHaveBeenCalledWith(expect.anything(), venue, 1.2);
});

it('the alert loop plays the venue chime (3 s) until stopped', async () => {
  const venue = { chime: 'soft', chimeUrl: 'https://cdn/x.mp3' };
  const loop = startAlertLoop(60, () => undefined, venue);
  await vi.waitFor(() => expect(play).toHaveBeenCalledWith(expect.anything(), venue, 3));
  loop.stop();
});
