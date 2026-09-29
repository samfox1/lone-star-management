/**
 * The real engine: the evidence gatherers and the 24 tests, wired for `runSeoTests` (run.ts).
 *
 * The ONE module that imports the pieces built beside the run (evidence, the four test groups,
 * the share picture, MusicBrainz, the Apple storefront fix). run.ts loads it lazily and only
 * when no engine is injected, so the run's unit tests use fakes and never load this file.
 */
import { gatherSiteEvidence } from './evidence'
import { FACTS_TESTS } from './facts'
import { FOUND_TESTS } from './found'
import { appleStorefrontFix } from './apple-storefront'
import { lookupMusicBrainz } from './musicbrainz'
import type { SeoEngine } from './run'
import { fetchShareImage } from './share-image'
import { SHARED_TESTS } from './shared'
import { WHO_TESTS } from './who'

export const SEO_ENGINE: SeoEngine = {
  gatherSiteEvidence: (origin, opts) => gatherSiteEvidence(origin, opts),
  fetchShareImage: (homeHtml, origin, opts) => fetchShareImage(homeHtml, origin, opts),
  lookupMusicBrainz: (known, opts) => lookupMusicBrainz(known, opts),
  tests: { ...FOUND_TESTS, ...WHO_TESTS, ...SHARED_TESTS, ...FACTS_TESTS },
  appleStorefrontFix: (url) => appleStorefrontFix(url)?.fixed ?? null,
}
