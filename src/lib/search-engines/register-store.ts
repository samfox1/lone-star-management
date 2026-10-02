/**
 * The registration's database side on the SERVICE client (lib/supabase/admin): the only role that
 * may write site_verifications (20260930120000; closed to every signed-in user, admins included).
 * Split from register.ts so the mutation slice (DB-free tests only) doesn't count these queries,
 * which are pinned by tests/integration/site/site-register-store.test.ts against the real table.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { RegisterStore, Row } from './register'

/** The store on the SERVICE client (lib/supabase/admin): the only role that may write the table. */
export function supabaseStore(svc: SupabaseClient): RegisterStore {
  const fail = (what: string, e: { message: string } | null) => {
    if (e) throw new Error(`site_verifications ${what}: ${e.message}`)
  }
  return {
    async holderOf(siteUrl, notArtist) {
      const { data, error } = await svc.from('site_verifications').select('artist_id').eq('site_url', siteUrl).neq('artist_id', notArtist).limit(1)
      fail('read', error)
      return (data?.[0]?.artist_id as string | undefined) ?? null
    },
    async rowsOf(artistId) {
      const { data, error } = await svc.from('site_verifications').select('provider, site_url, code, verified_at, error_code').eq('artist_id', artistId)
      fail('read', error)
      return (data ?? []) as Row[]
    },
    async upsert(artistId, rows) {
      const { error } = await svc.from('site_verifications').upsert(
        rows.map((r) => ({ artist_id: artistId, provider: r.provider, site_url: r.site_url, code: r.code, error_code: null, ...(r.reset ? { verified_at: null } : {}) })),
        { onConflict: 'artist_id,provider' },
      )
      fail('write', error)
    },
    async remove(artistId, providers) {
      const { error } = await svc.from('site_verifications').delete().eq('artist_id', artistId).in('provider', providers)
      fail('delete', error)
    },
    async restore(artistId, rows) {
      const { error } = await svc.from('site_verifications').upsert(
        rows.map((r) => ({ artist_id: artistId, provider: r.provider, site_url: r.site_url, code: r.code, verified_at: r.verified_at, error_code: r.error_code })),
        { onConflict: 'artist_id,provider' },
      )
      fail('restore', error)
    },
    async mark(artistId, provider, result) {
      const { error } = await svc
        .from('site_verifications')
        .update({ error_code: result.error_code, verified_at: result.verified ? new Date().toISOString() : null })
        .eq('artist_id', artistId)
        .eq('provider', provider)
      fail('mark', error)
    },
    async siteOf(artistId) {
      const { data, error } = await svc.from('artists').select('site_kind, custom_site_url').eq('id', artistId).maybeSingle()
      if (error) throw new Error(`artists read: ${error.message}`)
      return data as { site_kind: string | null; custom_site_url: string | null } | null
    },
    async connect(artistId, origin) {
      const { error } = await svc.from('artists').update({ site_kind: 'custom', custom_site_url: origin }).eq('id', artistId)
      if (error) throw new Error(`artists connect: ${error.message}`)
    },
  }
}
