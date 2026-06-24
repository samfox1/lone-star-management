/**
 * Session refresh + route protection, run on every matched request by the proxy.
 *
 * Two jobs:
 *  1. Refresh the Supabase auth cookie so server components never see a stale
 *     session (tokens rotate; this writes the new one back onto the response).
 *  2. Redirect unauthenticated callers away from protected pages to /login.
 *
 * IMPORTANT: always return `supabaseResponse` (or a redirect built from its
 * cookies) so the refreshed session cookie survives.
 */
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

/** Pages reachable while logged out. Everything else requires a session. */
const PUBLIC_PATHS = ['/login']

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  // Do not run any code between createServerClient and getUser() — it keeps the
  // session fresh and avoids hard-to-debug logout bugs.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Exact-match allowlist: keep the public surface exactly as wide as intended.
  // Add new logged-out routes (e.g. '/auth/callback') here explicitly.
  const isPublic = PUBLIC_PATHS.includes(request.nextUrl.pathname)

  if (!user && !isPublic) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    const redirectResponse = NextResponse.redirect(url)
    // Carry over any refreshed auth cookies set on supabaseResponse, otherwise
    // a rotated session token is dropped on the redirect and the next request
    // replays a stale cookie (the logout/redirect-loop bug this file warns of).
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      redirectResponse.cookies.set(cookie)
    })
    return redirectResponse
  }

  return supabaseResponse
}
