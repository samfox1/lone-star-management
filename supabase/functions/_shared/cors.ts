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
