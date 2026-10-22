import { BlockList, isIP } from 'node:net';

// Parsed IP classification for outbound requests (L-16). Every address is parsed to bytes, IPv4 embedded in IPv6
// (mapped, including hexadecimal forms such as ::ffff:7f00:1) is classified as IPv4, and only global unicast
// destinations are allowed: IPv6 must be inside 2000::/3 and outside every special-purpose block below; IPv4 must be
// outside every special-purpose block (IANA IPv4/IPv6 Special-Purpose Address Registries, RFC 6890 and updates).
// Anything that does not parse (including zone-scoped "fe80::1%eth0") is treated as not public.

const V4_SPECIAL: ReadonlyArray<[string, number]> = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // CGNAT shared address space
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local (cloud metadata)
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // TEST-NET-1
  ['192.31.196.0', 24], // AS112-v4
  ['192.52.193.0', 24], // AMT
  ['192.88.99.0', 24], // deprecated 6to4 relay anycast
  ['192.168.0.0', 16], // private
  ['192.175.48.0', 24], // direct delegation AS112
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24], // TEST-NET-3
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, including 255.255.255.255 broadcast
];

// Special-purpose blocks inside 2000::/3. Everything outside 2000::/3 (::/128, ::1, ::/96 IPv4-compatible,
// ::ffff:0:0/96 handled separately, 64:ff9b::/96 and 64:ff9b:1::/48 NAT64, 100::/64 discard, fc00::/7 ULA,
// fe80::/10 link-local, fec0::/10 site-local, ff00::/8 multicast …) is refused by the 2000::/3 rule.
const V6_SPECIAL: ReadonlyArray<[string, number]> = [
  ['2001::', 23], // IETF protocol assignments: Teredo 2001::/32, benchmarking 2001:2::/48, ORCHID(v2) 2001:10::/28, 2001:20::/28 …
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4
  ['2620:4f:8000::', 48], // AS112-v6
  ['3fff::', 20], // documentation (RFC 9637)
];

const v4Block = new BlockList();
for (const [net, prefix] of V4_SPECIAL) v4Block.addSubnet(net, prefix, 'ipv4');
const v6Block = new BlockList();
for (const [net, prefix] of V6_SPECIAL) v6Block.addSubnet(net, prefix, 'ipv6');
const v6GlobalUnicast = new BlockList();
v6GlobalUnicast.addSubnet('2000::', 3, 'ipv6');

/** Parses an IPv6 address (with optional trailing dotted IPv4) into 16 bytes; null when it is not one. */
export function parseIPv6(ip: string): number[] | null {
  if (isIP(ip) !== 6 || ip.includes('%')) return null;
  let s = ip.toLowerCase();
  let tail: number[] = [];
  if (s.includes('.')) {
    // Trailing dotted IPv4 ("::ffff:127.0.0.1", "64:ff9b::10.0.0.1") becomes the last two groups.
    const i = s.lastIndexOf(':');
    const v4 = parseIPv4(s.slice(i + 1));
    if (!v4) return null;
    tail = [(v4[0]! << 8) | v4[1]!, (v4[2]! << 8) | v4[3]!];
    s = s.slice(0, i + 1);
    if (!s.endsWith('::')) s = s.slice(0, -1);
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const toGroups = (h: string) => (h === '' ? [] : h.split(':').map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN)));
  let groups: number[];
  if (halves.length === 2) {
    const head = toGroups(halves[0]!);
    const rest = toGroups(halves[1]!);
    const fill = 8 - head.length - rest.length - tail.length;
    if (fill < 0) return null;
    groups = [...head, ...new Array<number>(fill).fill(0), ...rest, ...tail];
  } else {
    groups = [...toGroups(halves[0]!), ...tail];
  }
  if (groups.length !== 8 || groups.some((g) => !Number.isInteger(g) || g < 0 || g > 0xffff)) return null;
  return groups.flatMap((g) => [g >> 8, g & 0xff]);
}

/** Parses a strict dotted-quad IPv4 address into 4 bytes; null when it is not one. */
export function parseIPv4(ip: string): number[] | null {
  if (isIP(ip) !== 4) return null;
  const parts = ip.split('.').map(Number);
  return parts.length === 4 && parts.every((p) => Number.isInteger(p) && p >= 0 && p <= 255) ? parts : null;
}

const v6String = (b: number[]) => Array.from({ length: 8 }, (_, i) => ((b[2 * i]! << 8) | b[2 * i + 1]!).toString(16)).join(':');

/** The IPv4 address an IPv4-mapped IPv6 address (::ffff:0:0/96) stands for, or null. */
export function mappedIPv4(ip: string): string | null {
  const b = parseIPv6(ip);
  if (!b || b.slice(0, 10).some((x) => x !== 0) || b[10] !== 0xff || b[11] !== 0xff) return null;
  return b.slice(12).join('.');
}

export type IpClassification = { public: true; family: 4 | 6; address: string } | { public: false; reason: 'invalid' | 'special' | 'not-global-unicast' };

/** Classifies an IP literal; only `public: true` destinations may be contacted. */
export function classifyIp(ip: string): IpClassification {
  const v4 = parseIPv4(ip);
  if (v4) return v4Block.check(ip, 'ipv4') ? { public: false, reason: 'special' } : { public: true, family: 4, address: ip };
  const b = parseIPv6(ip);
  if (!b) return { public: false, reason: 'invalid' };
  const mapped = mappedIPv4(ip);
  if (mapped) {
    const c = classifyIp(mapped);
    return c.public ? { public: true, family: 4, address: mapped } : c;
  }
  const canonical = v6String(b);
  if (!v6GlobalUnicast.check(canonical, 'ipv6')) return { public: false, reason: 'not-global-unicast' };
  if (v6Block.check(canonical, 'ipv6')) return { public: false, reason: 'special' };
  return { public: true, family: 6, address: canonical };
}

/** True unless the address is a globally routable unicast address (fails closed on anything unparsable). */
export function isNonPublicIp(ip: string): boolean {
  return !classifyIp(ip).public;
}

/** Whether `ip` lies in `cidr` ("10.0.0.0/8", "2001:db8::/32"); IPv4-mapped IPv6 matches IPv4 ranges. Reusable CIDR helper. */
export function ipInCidr(ip: string, cidr: string): boolean {
  const [net, p] = cidr.split('/');
  const prefix = Number(p);
  if (!net || !Number.isInteger(prefix)) return false;
  const list = new BlockList();
  const fam = parseIPv4(net) ? 'ipv4' : parseIPv6(net) ? 'ipv6' : null;
  if (!fam || prefix < 0 || prefix > (fam === 'ipv4' ? 32 : 128)) return false;
  list.addSubnet(net, prefix, fam);
  const v4 = parseIPv4(ip) ? ip : mappedIPv4(ip);
  if (fam === 'ipv4') return v4 ? list.check(v4, 'ipv4') : false;
  const b = parseIPv6(ip);
  return b ? list.check(v6String(b), 'ipv6') : false;
}
