/**
 * Next.js 16 proxy (formerly "middleware"). Runs before matched requests to
 * refresh the Supabase session and gate protected routes. The real logic lives
 * in lib/supabase/middleware so it can be unit-reasoned about in isolation.
 */
import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function proxy(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  // Run on everything except Next internals and static assets, so the session
  // cookie is refreshed across the app while keeping asset requests cheap.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
