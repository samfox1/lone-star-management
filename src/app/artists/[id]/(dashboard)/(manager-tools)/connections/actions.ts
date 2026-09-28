'use server'

import { revalidatePath } from 'next/cache'
import { socialSlug } from '@samfox1/site-bridge/social'
import { createClient } from '@/lib/supabase/server'
import {
  SHOPIFY_KEY,
  connectInputError,
  connectionByKey,
  idFromProfileUrl,
  isProfileLink,
  profileLink,
  wantsSync,
  type ConnectInput,
  type LinkRowLike,
} from '@/lib/connections'
import { probeAdvice } from '@/lib/merch/probe'
import type { ReturnReason } from '@/lib/merch/shopify-oauth'
import { addContentAction, deleteContentAction, saveSourceIdAction } from '../../actions'
import { INTEGRATIONS } from '../../integrations'
import { connectShopifyAction, disconnectShopifyAction, probeShopifyAction, syncShopifyAction } from '../../merch/actions'
import { syncSectionAction } from '../../sync-section-action'

/**
 * The connected store's domain, for the edit window to show before a manager changes it —
 * never the token, which stays in Vault and is read only by the probe/sync RPCs. Reads
 * `integrations.metadata` the same way the page does (`getShopifyDomain`, `_data.ts`),
 * duplicated as a plain query rather than imported: `_data.ts` pulls in `unstable_cache`
 * for its unrelated `dashboardDiff` export, which every test mocking `next/cache` here
 * would then have to stub too.
 */
export async function getShopifyDomainAction(artistId: string): Promise<string | null> {
  const supabase = await createClient()
  const { data } = await supabase.from('integrations').select('metadata').eq('artist_id', artistId).eq('provider', 'shopify').maybeSingle()
  return (data?.metadata as { store_domain?: string } | null)?.store_domain ?? null
}

/**
 * CONNECTING, one platform at a time (Sam, 2026-09-13: "clear error handling… a cool ui
 * to show the process of the services trying to connect").
 *
 * The modal calls this once per pick, in order, so each row's ring can turn while the
 * others wait. A connection that PULLS has to prove it did — the result carries what
 * came back ("24 songs") or, in one plain sentence, why nothing did. That is the same
 * standard the Shopify panel set: a token that saves is not a store that answers.
 *
 * One paste, two jobs. For Spotify, Apple Music and Deezer the artist id sits inside
 * the profile URL, so a social link that carries one also connects the catalog. A link
 * without one (a playlist) still saves the profile and says nothing about a catalog.
 */
export type ConnectResult = {
  ok: boolean
  /** What came back, for the row's line under the value ("Music · 24 songs found"). */
  message?: string
  /** Why it did not, in one sentence. */
  error?: string
  /** What to do about it, when we know (the Shopify probe's advice). */
  detail?: string
  /** Shopify only: where the save stopped, as a CODE (`connect`, `probe-bad-token`, `sync`)
   *  — what the OAuth callback puts in its return URL instead of any text. */
  reason?: ReturnReason
}

export async function connectOneAction(artistId: string, key: string, input: ConnectInput): Promise<ConnectResult> {
  const def = connectionByKey(key)
  if (!def) return { ok: false, error: 'Unknown connection.' }
  // Refused here too, not only in the modal: the action is the door, the modal is the
  // affordance (the same split the social picker draws).
  const problem = connectInputError(def, input)
  if (problem) return { ok: false, error: problem }

  try {
    if (def.key === SHOPIFY_KEY) return await connectShopify(artistId, input)

    let pulled: ConnectResult | null = null
    if (def.social) {
      // A handle becomes its link here, the same way the modal showed it (lib/connect-methods).
      const link = profileLink(def, input)
      if ('error' in link) return { ok: false, error: link.error }
      const url = link.url
      // Idempotent: a Retry after the link saved but the pull failed must not be refused
      // with "Spotify is already on this site". The profile link that exists is the one,
      // and its on-site flag is left as it is — the manager may have made it a button.
      const existing = (await profileLinks(artistId)).find((l) => socialSlug(l.label ?? '') === def.social)
      if (!existing) {
        const fd = new FormData()
        fd.set('label', def.label)
        fd.set('url', url)
        // OFF the site (Sam, 2026-09-28: connecting X put the link on the site unasked).
        // A connection is an account; the editor's Socials is where it becomes a button.
        const added = await addContentAction('link', artistId, fd, { offSite: true })
        if (added.error) return { ok: false, error: added.error }
      }
      // Sync off (Sam, 2026-09-28): the profile is linked, nothing is pulled.
      const id = wantsSync(def, input) ? input.id?.trim() || idFromProfileUrl(def, url) : null
      if (def.source?.idField && id) pulled = await connectSource(artistId, def.source.idField, def.source.key, id)
    } else if (def.source?.idField) {
      pulled = await connectSource(artistId, def.source.idField, def.source.key, input.id!.trim())
    }
    revalidatePath(`/artists/${artistId}`, 'layout')
    return pulled ?? { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Couldn’t connect.' }
  }
}

/** The artist's profile links, as the page reads them: role-bound rows (the USB button's
 *  playlist, labelled "Spotify") and contact rows are not profiles, whatever their label. */
async function profileLinks(artistId: string): Promise<LinkRowLike[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('links').select('id, label, url, role').eq('artist_id', artistId)
  if (error) throw new Error(error.message)
  return ((data ?? []) as LinkRowLike[]).filter(isProfileLink)
}

/** Save the id, then pull — a saved id that pulls nothing is not a connection. */
async function connectSource(artistId: string, idField: string, sourceKey: string, id: string): Promise<ConnectResult> {
  const saved = await saveSourceIdAction(artistId, idField, id)
  if (saved.error) return { ok: false, error: saved.error }
  const intg = INTEGRATIONS.find((i) => i.key === sourceKey)
  if (!intg) return { ok: true }
  const res = await intg.pull(artistId)
  if (!res.ok) return { ok: false, error: res.error ?? `${intg.label} didn’t answer.` }
  return { ok: true, message: res.message }
}

async function connectShopify(artistId: string, input: ConnectInput): Promise<ConnectResult> {
  const fd = new FormData()
  fd.set('store_domain', input.domain!.trim())
  fd.set('storefront_token', input.token!.trim())
  const connected = await connectShopifyAction(artistId, fd)
  if (connected.error) return { ok: false, error: connected.error, reason: 'connect' }
  const probe = await probeShopifyAction(artistId)
  if (!probe.ok) {
    const advice = probeAdvice(probe.reason)
    return { ok: false, error: advice.title, detail: advice.fix, reason: `probe-${probe.reason}` }
  }
  const pulled = await syncShopifyAction(artistId)
  if (!pulled.ok) return { ok: false, error: pulled.error, reason: 'sync' }
  return { ok: true, message: pulled.message ?? `${probe.products.length} product${probe.products.length === 1 ? '' : 's'} found` }
}

/**
 * Remove a connection: the profile link (if any) AND the source behind it. A manager
 * who removes Spotify means Spotify, not "the link but keep pulling the catalog".
 */
export async function disconnectConnectionAction(artistId: string, key: string, linkId?: string | null): Promise<{ error?: string }> {
  const def = connectionByKey(key)
  if (!def) return { error: 'Unknown connection.' }
  if (linkId) {
    const res = await deleteContentAction('link', linkId, artistId)
    if (res?.error) return { error: res.error }
  }
  if (def.key === SHOPIFY_KEY) return disconnectShopifyAction(artistId)
  if (def.source?.idField) return saveSourceIdAction(artistId, def.source.idField, '')
  return {}
}

/**
 * SYNC a profile that is already on the page but whose catalog was never pulled (Sam,
 * 2026-09-13: a check beside "+ Connect" read as a contradiction — the account IS
 * connected; what it lacks is the sync). The artist id is inside the profile link for
 * Spotify, Apple Music and Deezer, so this needs nothing typed: read the link, take the
 * id, save it, pull. A link with no id in it (a playlist) says so, and Edit is the fix.
 */
export async function syncProfileAction(artistId: string, key: string): Promise<ConnectResult> {
  const def = connectionByKey(key)
  if (!def?.social || !def.source?.idField) return { ok: false, error: 'Nothing to sync.' }
  let link: LinkRowLike | undefined
  try {
    link = (await profileLinks(artistId)).find((l) => socialSlug(l.label ?? '') === def.social)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Couldn’t read the links.' }
  }
  const id = link ? idFromProfileUrl(def, link.url ?? '') : null
  if (!id) return { ok: false, error: `That ${def.label} link has no artist id in it — it needs to be the artist page.` }
  try {
    const res = await connectSource(artistId, def.source.idField, def.source.key, id)
    revalidatePath(`/artists/${artistId}`, 'layout')
    return res
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Couldn’t sync.' }
  }
}

/** Pull this connection's content again — the modal's "Pull now", and a failed row's Retry. */
export async function pullConnectionAction(artistId: string, key: string): Promise<ConnectResult> {
  const def = connectionByKey(key)
  if (!def?.source) return { ok: false, error: 'Nothing to pull.' }
  const { results } = await syncSectionAction(artistId, def.source.section, [def.source.key])
  const r = results[0]
  if (!r) return { ok: false, error: `${def.label} isn’t connected.` }
  return { ok: r.ok, message: r.message, error: r.error }
}
