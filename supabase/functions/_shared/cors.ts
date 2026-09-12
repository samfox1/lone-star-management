/**
 * CORS for the public Edge Function doors.
 *
 * The artist sites are on their own origins (skeen ships from its own domain, see
 * artists.custom_site_url), so every request here is cross-origin and a preflight is
 * mandatory.
 *
 * `apikey` and `x-client-info` in Allow-Headers are the two everyone forgets. The
 * supabase-js client sends both, and omitting either fails the PREFLIGHT — which the
 * browser reports as a generic opaque CORS error that looks nothing like "you forgot a
 * header", so it costs an afternoon every time.
 */
export function corsHeaders(allowOrigin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    // Without Vary, a shared cache can hand origin A's response to origin B.
    Vary: 'Origin',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
  }
}

/** JSON response that ALWAYS carries the CORS headers — including on error paths. */
export function json(
  status: number,
  body: unknown,
  allowOrigin: string,
  extra: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(allowOrigin), 'Content-Type': 'application/json', ...extra },
  })
}

/** Parse a comma-separated origin allowlist secret (trailing slashes and blanks dropped). */
export function parseAllowedOrigins(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean)
}

/**
 * The Access-Control-Allow-Origin to answer with when a door HAS an allowlist: the
 * caller's origin if it is listed, else the first listed origin (so an unlisted caller's
 * browser refuses the response), else 'null' (nobody listed → nobody allowed). This is
 * the /contact semantics; a door that means "any origin" must say so in its own code
 * (see event/derive.ts reflectOrAllowlisted), never by passing an empty list here.
 */
export function pickAllowedOrigin(origin: string | null, allowed: string[]): string {
  if (origin && allowed.includes(origin)) return origin
  return allowed[0] ?? 'null'
}
