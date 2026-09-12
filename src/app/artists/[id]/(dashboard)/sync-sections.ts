import type { SyncNote } from '@/lib/sync'
import { INTEGRATIONS, isConnected, type IntegrationArtist } from './integrations'

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
/** One data source a page's content can be pulled from, resolved by the PAGE — an id
 *  column for the platform integrations, Vault for Shopify. The dialog never decides who
 *  is connected; it chooses among what it is given and reports what happened. */
export type SyncSource = { key: string; label: string; connected: boolean }

/** What one source did on this run. `syncOutcome` (lib/sync) writes both strings, and
 *  `notes` names the songs it could not settle on its own (Sam, 2026-09-12). */
export type SyncRunResult = {
  key: string
  label: string
  ok: boolean
  message?: string
  error?: string
  notes?: SyncNote[]
}

export const SYNC_SECTIONS = ['music', 'videos', 'tour', 'files', 'merch'] as const
export type SyncSection = (typeof SYNC_SECTIONS)[number]

/** Shopify's key. Not from the registry, so it is a constant both halves read. */
export const SHOPIFY_KEY = 'shopify'

/**
 * What KIND of service each section pulls from, for the dialog's empty state (Sam,
 * 2026-09-09: "it should say no merchandise service integrations").
 *
 * Its own map rather than `SECTION_LABEL`: that one names the CONTENT ("Music", "Tour
 * dates") for the integrations hub's group headings, and "No Tour dates integrations"
 * reads as a typo. This names the SOURCE, which is what is missing.
 */
export const SECTION_SERVICE_NOUN: Record<SyncSection, string> = {
  music: 'music service',
  videos: 'video service',
  tour: 'tour date service',
  files: 'file service',
  merch: 'merchandise service',
}

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
