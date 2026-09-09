import { INTEGRATIONS, isConnected, type IntegrationArtist } from './integrations'
import type { SyncSource } from './sync-dialog'

/**
 * WHICH SOURCES A PAGE'S SYNC BUTTON OFFERS.
 *
 * The dialog is given a section and shows what can be pulled into it (Sam, 2026-09-09:
 * "if the user clicks sync on the music tab… all of the music integrations connected…
 * if the user is on merch, then the merch integrations should appear").
 *
 * Derived from `INTEGRATIONS` (AGENTS.md rule 4), so a fourth music service added to that
 * registry appears in the dialog without anyone remembering this file.
 *
 * MERCH IS THE ODD ONE, and deliberately. Shopify is not in the registry — it has no
 * artist-id column, it is a connect/disconnect token in Vault (see that registry's
 * header) — so it is resolved by name here rather than bent into a shape it does not
 * have. Reading it from an id field would report every artist as disconnected forever,
 * with no error anywhere.
 */
export const SYNC_SECTIONS = ['music', 'videos', 'tour', 'files', 'merch'] as const
export type SyncSection = (typeof SYNC_SECTIONS)[number]

/** Shopify's key. Not from the registry, so it is a constant both halves read. */
export const SHOPIFY_KEY = 'shopify'

export function sourcesForSection(
  section: SyncSection,
  artist: IntegrationArtist,
  shopifyConnected: boolean,
): SyncSource[] {
  if (section === 'merch') {
    return [{ key: SHOPIFY_KEY, label: 'Shopify', connected: shopifyConnected }]
  }
  return INTEGRATIONS.filter((i) => i.section === section).map((i) => ({
    key: i.key,
    label: i.label,
    connected: isConnected(i, artist),
  }))
}
