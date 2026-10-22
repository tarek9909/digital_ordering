import { describe, expect, it } from 'vitest';
import { checkWebhookUrl, classifyIp, ipInCidr, isNonPublicIp, mappedIPv4, parseIPv6, resolvePublic } from '../src/webhooks.js';

// L-16 (2026-10-22 security audit): parsed IP classification for outgoing webhooks.

const BLOCKED = [
  // the audit's bypass forms
  '::ffff:7f00:1',
  '::ffff:a9fe:a9fe',
  'fe81::1',
  'febf::1',
  // IPv4 special-purpose
  '0.0.0.0',
  '0.1.2.3',
  '10.1.2.3',
  '100.64.0.1',
  '100.127.255.254',
  '127.0.0.1',
  '127.255.255.255',
  '169.254.169.254',
  '172.16.0.1',
  '172.31.255.255',
  '192.0.0.8',
  '192.0.2.1',
  '192.88.99.1',
  '192.168.1.1',
  '198.18.0.1',
  '198.19.255.255',
  '198.51.100.7',
  '203.0.113.9',
  '224.0.0.1',
  '239.255.255.250',
  '240.0.0.1',
  '255.255.255.255',
  // IPv4-mapped, dotted and hexadecimal, any spelling
  '::ffff:127.0.0.1',
  '::FFFF:7F00:0001',
  '0:0:0:0:0:ffff:7f00:1',
  '::ffff:10.0.0.1',
  '::ffff:c0a8:101',
  '::ffff:169.254.169.254',
  // IPv4-compatible (deprecated) and unspecified/loopback
  '::',
  '::1',
  '0:0:0:0:0:0:0:1',
  '::127.0.0.1',
  '::7f00:1',
  '::8.8.8.8',
  // ULA, link-local (whole fe80::/10), site-local, multicast
  'fc00::1',
  'fd00:ec2::254',
  'fdff:ffff::1',
  'fe80::1',
  'fe80::1%eth0',
  'fea0::1',
  'fec0::1',
  'feff::1',
  'ff02::1',
  'ff0e::1',
  // NAT64, discard, documentation, 6to4, Teredo, ORCHID, benchmarking
  '64:ff9b::7f00:1',
  '64:ff9b::10.0.0.1',
  '64:ff9b:1::1',
  '100::1',
  '2001:db8::1',
  '3fff::1',
  '2002:7f00:1::1',
  '2002:c0a8:101::1',
  '2001:0:4136:e378:8000:63bf:3fff:fdd2',
  '2001:10::1',
  '2001:20::1',
  '2001:2::1',
  // not IPs at all
  'localhost',
  '',
  '1.2.3',
  '01.2.3.4',
];

const PUBLIC = ['8.8.8.8', '1.1.1.1', '93.184.215.14', '100.63.255.255', '100.128.0.1', '172.15.255.255', '172.32.0.1', '192.0.1.1', '198.17.255.255', '198.20.0.1', '223.255.255.254', '2001:4860:4860::8888', '2606:4700:4700::1111', '2a00:1450:4001:82a::200e', '2001:200::1', '::ffff:8.8.8.8', '::ffff:808:808'];

describe('IP classification (L-16)', () => {
  it.each(BLOCKED)('refuses %s', (ip) => {
    expect(isNonPublicIp(ip)).toBe(true);
  });
  it.each(PUBLIC)('allows public %s', (ip) => {
    expect(isNonPublicIp(ip)).toBe(false);
  });

  it('parses and converts IPv4-mapped forms', () => {
    expect(mappedIPv4('::ffff:7f00:1')).toBe('127.0.0.1');
    expect(mappedIPv4('::ffff:a9fe:a9fe')).toBe('169.254.169.254');
    expect(mappedIPv4('::ffff:1.2.3.4')).toBe('1.2.3.4');
    expect(mappedIPv4('2001:4860::1')).toBeNull();
    expect(parseIPv6('1::2:3.4.5.6')).toEqual([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 4, 5, 6]);
    expect(classifyIp('::ffff:808:808')).toEqual({ public: true, family: 4, address: '8.8.8.8' });
  });

  it('matches CIDRs for reuse', () => {
    expect(ipInCidr('10.2.3.4', '10.0.0.0/8')).toBe(true);
    expect(ipInCidr('::ffff:a02:304', '10.0.0.0/8')).toBe(true);
    expect(ipInCidr('11.0.0.1', '10.0.0.0/8')).toBe(false);
    expect(ipInCidr('2001:db8::5', '2001:db8::/32')).toBe(true);
    expect(ipInCidr('2001:db9::5', '2001:db8::/32')).toBe(false);
    expect(ipInCidr('1.2.3.4', 'garbage')).toBe(false);
  });

  it('applies to webhook URLs and resolved addresses', async () => {
    expect(() => checkWebhookUrl('https://[::ffff:7f00:1]/x')).toThrow(/Private/);
    expect(() => checkWebhookUrl('https://[fe81::1]/x')).toThrow(/Private/);
    expect(() => checkWebhookUrl('https://169.254.169.254/x')).toThrow(/Private/);
    expect(() => checkWebhookUrl('https://0x7f.1/x')).toThrow(/Private/); // URL parser normalises to 127.0.0.1
    expect(checkWebhookUrl('https://hooks.example.com/x').hostname).toBe('hooks.example.com');
    for (const ip of ['::ffff:7f00:1', '::ffff:a9fe:a9fe', 'fe81::1', 'febf::1']) {
      await expect(resolvePublic('controlled.invalid', async () => [ip])).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    }
    // One private answer among public ones is refused (DNS pinning uses only checked answers).
    await expect(resolvePublic('controlled.invalid', async () => ['8.8.8.8', '10.0.0.1'])).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(resolvePublic('controlled.invalid', async () => [])).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await resolvePublic('controlled.invalid', async () => ['2001:4860:4860::8888', '8.8.4.4'])).toBe('2001:4860:4860::8888');
    expect(await resolvePublic('[2606:4700:4700::1111]')).toBe('2606:4700:4700::1111');
  });
});
