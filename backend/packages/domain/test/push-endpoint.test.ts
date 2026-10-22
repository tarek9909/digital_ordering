import { describe, expect, it } from 'vitest';
import { pushServiceOf } from '../src/index.js';

// L-15 (2026-10-22 security audit): only the exact Web Push service hosts, https, default port.
describe('pushServiceOf allowlist (L-15)', () => {
  it('accepts the real browser push services', () => {
    expect(pushServiceOf('https://fcm.googleapis.com/fcm/send/abc:def')).toBe('fcm');
    expect(pushServiceOf('https://fcm.googleapis.com:443/fcm/send/abc')).toBe('fcm');
    expect(pushServiceOf('https://updates.push.services.mozilla.com/wpush/v2/gAAAA')).toBe('mozilla');
    expect(pushServiceOf('https://web.push.apple.com/QGsd7')).toBe('apns');
    expect(pushServiceOf('https://wns2-par02p.notify.windows.com/w/?token=BQYAAA')).toBe('wns');
    expect(pushServiceOf('https://FCM.GoogleAPIs.com/fcm/send/x')).toBe('fcm');
  });

  it('refuses other hosts under the provider domains', () => {
    for (const e of [
      'https://storage.googleapis.com/attacker-bucket/x',
      'https://android.googleapis.com/gcm/send/x',
      'https://www.googleapis.com/x',
      'https://evil.mozilla.com/x',
      'https://push.services.mozilla.com/x',
      'https://a.b.push.apple.com/x',
      'https://push.apple.com/x',
      'https://a.b.notify.windows.com/x',
      'https://fcm.googleapis.com.evil.example/x',
      'https://evilfcm.googleapis.com/x',
      'https://fcm.googleapis.com./x',
      'https://evil.example.com/x',
      'https://169.254.169.254/latest/meta-data',
    ]) {
      expect(pushServiceOf(e), e).toBeNull();
    }
  });

  it('requires https, the default port and no credentials', () => {
    expect(pushServiceOf('http://fcm.googleapis.com/fcm/send/x')).toBeNull();
    expect(pushServiceOf('https://fcm.googleapis.com:8443/fcm/send/x')).toBeNull();
    expect(pushServiceOf('https://fcm.googleapis.com:80/fcm/send/x')).toBeNull();
    expect(pushServiceOf('https://user:pw@fcm.googleapis.com/fcm/send/x')).toBeNull();
    expect(pushServiceOf('wss://fcm.googleapis.com/x')).toBeNull();
    expect(pushServiceOf('not a url')).toBeNull();
  });
});
