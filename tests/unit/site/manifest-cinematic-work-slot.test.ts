// The cinematic manifest must not advertise a library slot the template can't fill.
/**
 * CODE_AUDIT finding (2026-09-18): `MANIFESTS.cinematic` declared a `work` slot with
 * `accepts: 'track'`, but `cinematic.tsx` never destructures `tracks` (it reads `artist,
 * tour_dates, links, media, videos` — verified `grep -n "tracks" src/components/templates/
 * cinematic.tsx` comes back empty) and no editor surface references the `'work'` slot key
 * (`grep -rn "'work'" "src/app/artists/[id]/(dashboard)/editor"` also empty). The Work
 * section is built from `spotify_artist_id` / a SoundCloud link, never a track library —
 * so the slot advertised a capability the template could never honour.
 */
import { describe, expect, it } from 'vitest'
import { MANIFESTS } from '@/lib/site-editor/manifest'

describe('MANIFESTS.cinematic', () => {
  it('declares no slot the template cannot fill: work tabs come from spotify_artist_id / a SoundCloud link, never a track slot', () => {
    const slotKeys = MANIFESTS.cinematic.slots.map((s) => s.key)
    expect(slotKeys).not.toContain('work')
  })
})
