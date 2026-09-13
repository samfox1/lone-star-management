'use server'

import { revalidatePath } from 'next/cache'
import {
  SHOPIFY_KEY,
  connectInputError,
  connectionByKey,
  idFromProfileUrl,
  type ConnectInput,
} from '@/lib/connections'
import { probeAdvice } from '@/lib/merch/probe'
import { addContentAction, deleteContentAction, saveSourceIdAction } from '../actions'
import { INTEGRATIONS } from '../integrations'
import { connectShopifyAction, disconnectShopifyAction, probeShopifyAction, syncShopifyAction } from '../merch/actions'
import { syncSectionAction } from '../sync-section-action'

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
      const url = input.url!.trim()
      const fd = new FormData()
      fd.set('label', def.label)
      fd.set('url', url)
      const added = await addContentAction('link', artistId, fd)
      if (added.error) return { ok: false, error: added.error }
      const id = input.id?.trim() || (def.source ? idFromProfileUrl(def, url) : null)
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
  if (connected.error) return { ok: false, error: connected.error }
  const probe = await probeShopifyAction(artistId)
  if (!probe.ok) {
    const advice = probeAdvice(probe.reason)
    return { ok: false, error: advice.title, detail: advice.fix }
  }
  const pulled = await syncShopifyAction(artistId)
  if (!pulled.ok) return { ok: false, error: pulled.error }
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

/** Pull this connection's content again — the ⋯ menu's "Pull now", and a failed row's Retry. */
export async function pullConnectionAction(artistId: string, key: string): Promise<ConnectResult> {
  const def = connectionByKey(key)
  if (!def?.source) return { ok: false, error: 'Nothing to pull.' }
  const { results } = await syncSectionAction(artistId, def.source.section, [def.source.key])
  const r = results[0]
  if (!r) return { ok: false, error: `${def.label} isn’t connected.` }
  return { ok: r.ok, message: r.message, error: r.error }
}
