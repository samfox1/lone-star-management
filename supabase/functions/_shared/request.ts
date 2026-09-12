/**
 * The client address, as the gateway saw it — and nothing the client could have written.
 *
 * Supabase's gateway is Cloudflare-fronted (probed 2026-09-11): `cf-connecting-ip` is the
 * connecting address and a client-supplied copy is refused by the gateway with 403.
 * `x-forwarded-for` is NOT that: Cloudflare APPENDS to whatever the client sent, so the
 * first hop is the client's to choose. A door that fell back to it would let an attacker
 * pick a fresh rate-limit bucket per request and choose the IP a geo lookup resolves.
 * So: the gateway's header, or 'unknown' — one strict shared bucket, no lookup.
 *
 * (`contact/validate.ts` still has the older `firstForwardedIp`; moving contact onto this
 * changes which bucket a request lands in on a deployed door, so that is a deliberate
 * change with its own redeploy, not a refactor.)
 */
export function clientIp(headers: { get(name: string): string | null }): string {
  const cf = headers.get('cf-connecting-ip')?.trim()
  return cf || 'unknown'
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/

/**
 * The address a per-IP rule should key on. IPv4 as given; IPv6 reduced to its /64 —
 * every consumer connection owns at least a /64, so a per-address key would hand an
 * attacker 2^64 fresh buckets. IPv4-mapped IPv6 (`::ffff:1.2.3.4`) becomes the IPv4.
 * Anything that is not an address → 'unknown'.
 */
export function normalizeIp(ip: string): string {
  const s = (ip ?? '').trim().toLowerCase()
  if (!s) return 'unknown'
  if (IPV4.test(s)) return s
  const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return IPV4.test(mapped[1]) ? mapped[1] : 'unknown'
  if (!s.includes(':') || !/^[0-9a-f:]+$/.test(s)) return 'unknown'
  const halves = s.split('::')
  if (halves.length > 2) return 'unknown'
  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  if (halves.length === 1 && head.length !== 8) return 'unknown'
  if (head.length + tail.length > 8) return 'unknown'
  if (halves.length === 2 && head.length + tail.length === 8) return 'unknown' // :: must stand for at least one group
  if ([...head, ...tail].some((h) => h.length === 0 || h.length > 4)) return 'unknown'
  const groups = [...head, ...Array(8 - head.length - tail.length).fill('0'), ...tail]
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':') + '::/64'
}
