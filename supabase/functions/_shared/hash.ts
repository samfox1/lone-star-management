/**
 * The one hashing routine both doors use. SHA-256 over a salted string, hex, truncated
 * to 32 chars (128 bits — far past collision concerns at this volume). Web Crypto only,
 * so vitest runs it under Node exactly as Deno runs it at the edge.
 */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** `sha256(salt:ip)`, 32 hex. The per-IP key for rate-limit ledgers and the geo cache. */
export async function hashIp(salt: string, ip: string): Promise<string> {
  return (await sha256Hex(`${salt}:${ip}`)).slice(0, 32)
}
