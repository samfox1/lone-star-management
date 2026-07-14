import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { customSiteUrl, isCustom } from '@/lib/custom-site'

describe('isCustom', () => {
  it('is a usable custom site only with kind=custom AND a url', () => {
    expect(isCustom({ site_kind: 'custom', custom_site_url: 'https://x.dev' })).toBe(true)
    expect(isCustom({ site_kind: 'custom', custom_site_url: null })).toBe(false)
    expect(isCustom({ site_kind: 'template', custom_site_url: 'https://x.dev' })).toBe(false)
    expect(isCustom(null)).toBe(false)
  })
})

/** Minimal fake for the from().select().eq().maybeSingle() chain used by customSiteUrl. */
function fakeClient(row: unknown): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: row }) }),
      }),
    }),
  } as unknown as SupabaseClient
}

describe('customSiteUrl', () => {
  it('returns the url for a custom-site artist', async () => {
    const sb = fakeClient({ site_kind: 'custom', custom_site_url: 'https://skeen-website.vercel.app' })
    expect(await customSiteUrl(sb, 'skeen')).toBe('https://skeen-website.vercel.app')
  })
  it('returns null for a built-in-template artist', async () => {
    expect(await customSiteUrl(fakeClient({ site_kind: 'template', custom_site_url: null }), 'a')).toBeNull()
    expect(await customSiteUrl(fakeClient(null), 'missing')).toBeNull()
  })
})
