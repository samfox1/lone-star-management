import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

/**
 * The DB-FREE slice of the suite, for mutation testing (see stryker.config.json).
 *
 * Stryker runs the tests once per mutant — hundreds of times. The main suite crosses
 * the internet to hosted Postgres on most files, so running THAT per mutant would take
 * days and hammer a live database. This config includes only files that touch no DB, so
 * a full mutation run is minutes.
 *
 * The cost of that trade is stated plainly: mutations to code reachable ONLY through a
 * live-DB test will show as survivors here even when a real test covers them. That is
 * why `stryker.config.json` mutates a curated list of pure modules rather than all of
 * `src/` — a survivor in this report should mean a real gap, not a config artefact.
 *
 * KEEPING IT HONEST: the include list below is a NEGATIVE filter (everything except the
 * DB suites), so a new DB-free test file is picked up automatically. A new DB-backed
 * file must be excluded, or the run gets slow and starts writing to the live project.
 * The guard is `tests/mutation-config.test.ts`, which fails if any included file imports
 * the Supabase test helpers.
 */
export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
    // Every suite that talks to the hosted project. Mirrored by the guard test.
    exclude: [
      '**/node_modules/**',
      'tests/**/*.isolation.test.ts',
      'tests/analytics.test.ts',
      'tests/media-rename-live.test.ts',
      'tests/publish-published-at-live.test.ts',
      'tests/analytics-rate-limit.test.ts',
      'tests/audio-signed-url.test.ts',
      'tests/audio-storage.test.ts',
      'tests/backfill.test.ts',
      'tests/brand-media.test.ts',
      'tests/publish-site-content.test.ts',
      'tests/new-release-badge.test.ts',
      'tests/restore-published.test.ts',
      'tests/integrations.test.ts',
      'tests/live-performance-type.test.ts',
      'tests/site-editor-gallery.test.ts',
      'tests/sync.test.ts',
      'tests/sync.apple.test.ts',
      'tests/sync.bandsintown.test.ts',
      'tests/sync.deezer.test.ts',
      'tests/sync.releases.test.ts',
      'tests/sync.shopify.test.ts',
      'tests/merch-live-door.test.ts',
      'tests/sync.ticketmaster.test.ts',
      'tests/sync.youtube.test.ts',
      'tests/content.crud.test.ts',
      'tests/content.on-site.test.ts',
      'tests/diff-unpublished.test.ts',
      'tests/drive-import.test.ts',
      'tests/editor-field-save.test.ts',
      'tests/editor-link-save.test.ts',
      'tests/editor-style-save.test.ts',
      'tests/enquiry-door.test.ts',
      'tests/epk-documents.test.ts',
      'tests/epk-publish.test.ts',
      'tests/fonts-publish.test.ts',
      'tests/links-on-site.test.ts',
      'tests/media.test.ts',
      'tests/media-gallery-gate.test.ts',
      'tests/music-doors.test.ts',
      'tests/music-mirror.test.ts',
      'tests/preview-parity.test.ts',
      'tests/publish-media.test.ts',
      'tests/publish-profile.test.ts',
      'tests/publish-reconcile.test.ts',
      'tests/publish-sections.test.ts',
      'tests/published-revisions.test.ts',
      'tests/release-door-asymmetry.test.ts',
      'tests/releases.publish.test.ts',
      'tests/releases.test.ts',
      'tests/site.test.ts',
      'tests/site-content.test.ts',
      'tests/song-merge.db.test.ts',
      'tests/style-publish-gate.test.ts',
      'tests/tour-support.test.ts',
      'tests/track-delete-gc.test.ts',
      'tests/tracks.crud.test.ts',
      'tests/video-hero-slot.test.ts',
      'tests/video-uploads.test.ts',
      'tests/videos.test.ts',
      'tests/custom-site.test.ts',
      'tests/on-site-paths.test.ts',
    ],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 20_000,
    clearMocks: true,
    restoreMocks: true,
  },
})
