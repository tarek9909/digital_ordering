import { BlockList, isIP } from 'node:net';

// Client addresses and IP rules: the trusted-proxy list (TRUST_PROXY) and the console allow-list (TR-SEC-12) are
// parsed here, so the API and the realtime server agree on who the client is.

/** `::ffff:203.0.113.5` and `::ffff:cb00:7105` → `203.0.113.5`; anything else is returned trimmed. */
export function normalizeIp(addr: string): string {
  let a = addr.trim();
  if (a.startsWith('[') && a.endsWith(']')) a = a.slice(1, -1);
  const zone = a.indexOf('%');
  if (zone > 0) a = a.slice(0, zone);
  if (isIP(a) === 6) {
    const g = expandIpv6(a);
    if (g && g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return `${g[6]! >> 8}.${g[6]! & 255}.${g[7]! >> 8}.${g[7]! & 255}`;
  }
  return a;
}

/** The eight 16-bit groups of a valid IPv6 address (dotted IPv4 tails included). */
export function expandIpv6(addr: string): number[] | null {
  if (isIP(addr) !== 6) return null;
  let a = addr.toLowerCase();
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(a);
  if (v4) {
    const o = v4[1]!.split('.').map(Number);
    a = `${a.slice(0, -v4[1]!.length)}${((o[0]! << 8) | o[1]!).toString(16)}:${((o[2]! << 8) | o[3]!).toString(16)}`;
  }
  const [head, tail] = a.split('::') as [string, string | undefined];
  const h = head ? head.split(':') : [];
  const t = tail !== undefined && tail ? tail.split(':') : [];
  const fill = tail !== undefined ? 8 - h.length - t.length : 0;
  const groups = [...h, ...Array<string>(Math.max(fill, 0)).fill('0'), ...t].map((x) => parseInt(x, 16));
  return groups.length === 8 && groups.every((x) => Number.isInteger(x) && x >= 0 && x <= 0xffff) ? groups : null;
}

export interface IpRules {
  /** The validated, normalised rules as written (for display). */
  readonly rules: string[];
  has(addr: string): boolean;
}

/** Parses IPv4/IPv6 addresses and CIDR ranges; `loopback` is 127.0.0.0/8 and ::1. Throws on a malformed rule. */
export function parseIpRules(input: readonly string[]): IpRules {
  const list = new BlockList();
  const rules: string[] = [];
  for (const raw of input) {
    const rule = raw.trim();
    if (!rule) continue;
    if (rule === 'loopback') {
      list.addSubnet('127.0.0.0', 8, 'ipv4');
      list.addAddress('::1', 'ipv6');
      rules.push(rule);
      continue;
    }
    const [addrPart, prefixPart, extra] = rule.split('/');
    const addr = normalizeIp(addrPart ?? '');
    const family = isIP(addr);
    if (!family || extra !== undefined) throw new Error(`Invalid IP rule "${rule}"`);
    const type = family === 4 ? 'ipv4' : 'ipv6';
    if (prefixPart === undefined) {
      list.addAddress(addr, type);
      rules.push(addr);
      continue;
    }
    if (!/^\d{1,3}$/.test(prefixPart)) throw new Error(`Invalid IP rule "${rule}"`);
    const prefix = Number(prefixPart);
    const max = family === 4 ? 32 : 128;
    // An IPv4-mapped IPv6 range written with an IPv6 prefix (::ffff:10.0.0.0/104) becomes its IPv4 range.
    const mappedPrefix = family === 4 && isIP(addrPart ?? '') === 6 ? prefix - 96 : prefix;
    if (mappedPrefix < 0 || mappedPrefix > max) throw new Error(`Invalid IP rule "${rule}"`);
    list.addSubnet(addr, mappedPrefix, type);
    rules.push(`${addr}/${mappedPrefix}`);
  }
  return {
    rules,
    has(addr: string) {
      const a = normalizeIp(addr);
      const family = isIP(a);
      if (!family) return false;
      return list.check(a, family === 4 ? 'ipv4' : 'ipv6');
    },
  };
}

/** Splits a comma-separated TRUST_PROXY-style value; `false`/empty means no entries. */
export function splitRules(value: string | undefined): string[] {
  const v = (value ?? '').trim();
  if (!v || v === 'false' || v === '0') return [];
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * The client address for a connection whose peer is `remote`, given the X-Forwarded-For header. Forwarded entries
 * are used only while each hop (starting from the direct peer) is a trusted proxy, so an untrusted client can never
 * choose its own address.
 */
export function clientAddress(remote: string | undefined, forwardedFor: string | string[] | undefined, trusted: IpRules): string {
  let addr = normalizeIp(remote ?? '');
  if (!addr || !trusted.has(addr)) return addr || '0.0.0.0';
  const header = Array.isArray(forwardedFor) ? forwardedFor.join(',') : (forwardedFor ?? '');
  const hops = header
    .split(',')
    .map((s) => normalizeIp(s))
    .filter(Boolean);
  for (let i = hops.length - 1; i >= 0; i--) {
    const hop = hops[i]!;
    if (!isIP(hop)) break;
    addr = hop;
    if (!trusted.has(hop)) break;
  }
  return addr;
}
