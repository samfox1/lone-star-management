// A photo removed in the editor keeps its file while a published version still points at it.
/**
 * Media object GC (review finding #1). A gallery photo removed in the editor is a DRAFT
 * change; its Storage object must NOT be destroyed while a published revision still
 * references it (the live site serves media from revision snapshots), or the live site
 * breaks and the file is unrecoverable. `gcDeletedMediaObject` removes the object only
 * when the media was never published; `gcMediaObjects` sweeps orphans at publish time.
 * Fake Supabase client — pure behavior, no live DB.
 */
import { describe, expect, it } from 'vitest'
import { MEDIA_FOLDERS, gcDeletedMediaObject, gcMediaObjects } from '@/lib/storage-gc'
import { BRAND_FOLDER } from '@/lib/brand'

type ListObj = { name: string; created_at: string | null }
function fake(
  opts: {
    revCount?: number
    mediaRows?: { storage_path: string }[]
    /** The EXACT count the server reports for the media read. Default: every row it
     *  returned (a complete read). Larger = PostgREST truncated the read (max-rows). */
    mediaCount?: number | null
    /** Objects per folder prefix. A prefix with no entry lists empty, like the real bucket. */
    byPrefix?: Record<string, ListObj[]>
  } = {},
) {
  const { revCount = 0, mediaRows = [], byPrefix = {} } = opts
  const mediaCount = opts.mediaCount === undefined ? mediaRows.length : opts.mediaCount
  const removed: string[] = []
  const listedPrefixes: string[] = []
  const eqCalls: [string, unknown][] = []
  const selectOpts: Record<string, unknown> = {}
  const thenable = (result: unknown): Record<string, unknown> => {
    const p: Record<string, unknown> = {
      select: () => p,
      eq: (col: string, val: unknown) => {
        eqCalls.push([col, val])
        return p
      },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej),
    }
    return p
  }
  const client = {
    from(table: string) {
      return {
        select: (_cols?: string, o?: unknown) => {
          selectOpts[table] = o
          return table === 'revisions' ? thenable({ count: revCount }) : thenable({ data: mediaRows, count: mediaCount })
        },
      }
    },
    storage: {
      from() {
        return {
          remove: (paths: string[]) => {
            removed.push(...paths)
            return Promise.resolve({ error: null })
          },
          list: (prefix: string) => {
            listedPrefixes.push(prefix)
            return Promise.resolve({ data: byPrefix[prefix] ?? [] })
          },
        }
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
  return { client, removed, listedPrefixes, eqCalls, selectOpts }
}

const OLD = new Date(Date.now() - 60 * 60 * 1000).toISOString() // 1h ago (past the age gate)

describe('gcDeletedMediaObject', () => {
  it('KEEPS the object when the media was published (a revision references it)', async () => {
    const { client, removed, eqCalls } = fake({ revCount: 1 })
    await gcDeletedMediaObject(client, 'm1', 'artist-1/gallery/a.jpg')
    expect(removed).toEqual([]) // live site still serves it from its snapshot
    // The publish check must be scoped to THIS media row — a query filtered on the wrong
    // entity_type (e.g. 'video') would count someone else's revisions and still pass here.
    expect(eqCalls).toContainEqual(['entity_type', 'media'])
    expect(eqCalls).toContainEqual(['entity_id', 'm1'])
  })

  it('removes the object when the media was never published (draft-only)', async () => {
    const { client, removed, eqCalls } = fake({ revCount: 0 })
    await gcDeletedMediaObject(client, 'm1', 'artist-1/gallery/a.jpg')
    expect(removed).toEqual(['artist-1/gallery/a.jpg'])
    expect(eqCalls).toContainEqual(['entity_type', 'media'])
    expect(eqCalls).toContainEqual(['entity_id', 'm1'])
  })

  it('no-ops without a storage path', async () => {
    const { client, removed } = fake({ revCount: 0 })
    await gcDeletedMediaObject(client, 'm1', null)
    expect(removed).toEqual([])
  })
})

describe('gcMediaObjects (publish-time sweep of the media folders)', () => {
  it('removes old unreferenced objects, keeps referenced ones', async () => {
    const { client, removed, listedPrefixes } = fake({
      mediaRows: [{ storage_path: 'artist-1/gallery/keep.jpg' }],
      byPrefix: {
        'artist-1/gallery': [
          { name: 'keep.jpg', created_at: OLD },
          { name: 'orphan.jpg', created_at: OLD },
        ],
      },
    })
    await gcMediaObjects(client, 'artist-1')
    expect(listedPrefixes).toContain('artist-1/gallery')
    expect(removed).toEqual(['artist-1/gallery/orphan.jpg'])
  })

  it('leaves a just-uploaded (fresh) unreferenced object alone (age gate)', async () => {
    const { client, removed } = fake({
      mediaRows: [],
      byPrefix: { 'artist-1/gallery': [{ name: 'fresh.jpg', created_at: new Date().toISOString() }] },
    })
    await gcMediaObjects(client, 'artist-1')
    expect(removed).toEqual([])
  })
  it("CRITICAL: sweeps hero-videos too — a replaced hero used to strand its old object forever", async () => {
    // Found 2026-07-15: the sweep only ever listed `{artist}/gallery`, so swapping a
    // hero left the old clip in a PUBLIC bucket, referenced by nothing and collected
    // by no one. skeen had 6 such strays (~17.6MB) from one hero change.
    const { client, removed, listedPrefixes } = fake({
      mediaRows: [{ storage_path: 'artist-1/hero-videos/current.mp4' }],
      byPrefix: {
        'artist-1/hero-videos': [
          { name: 'current.mp4', created_at: OLD },
          { name: 'old.mp4', created_at: OLD },
        ],
      },
    })
    await gcMediaObjects(client, 'artist-1')
    expect(listedPrefixes).toContain('artist-1/hero-videos')
    expect(removed).toEqual(['artist-1/hero-videos/old.mp4'])
  })

  it('CRITICAL: sweeps brand too — logos and the regenerated favicon', async () => {
    // The same regression as hero-videos, re-introduced 2026-08-04 by adding three media
    // purposes (logo_primary/logo_secondary/favicon) without adding their folder. It
    // matters more here: the favicon is REGENERATED on every save, so re-framing the tab
    // icon three times leaves three strays in a PUBLIC bucket.
    const { client, removed, listedPrefixes } = fake({
      mediaRows: [
        { storage_path: 'artist-1/brand/logo-current.png' },
        { storage_path: 'artist-1/brand/favicon-current.png' },
      ],
      byPrefix: {
        'artist-1/brand': [
          { name: 'logo-current.png', created_at: OLD },
          { name: 'favicon-current.png', created_at: OLD },
          { name: 'logo-old.png', created_at: OLD },
          { name: 'favicon-old.png', created_at: OLD },
        ],
      },
    })
    await gcMediaObjects(client, 'artist-1')
    expect(listedPrefixes).toContain('artist-1/brand')
    expect(removed.sort()).toEqual(['artist-1/brand/favicon-old.png', 'artist-1/brand/logo-old.png'])
  })

  it('CRITICAL: every folder an uploader writes to is swept', async () => {
    // The guard that would have caught the above without anyone thinking of brand:
    // MEDIA_FOLDERS must contain the category every media uploader passes to
    // buildStoragePath. Add a purpose, add its folder — or this fails.
    for (const folder of ['gallery', 'hero-videos', 'profile', BRAND_FOLDER]) {
      expect(MEDIA_FOLDERS).toContain(folder)
    }
  })

  it('sweeps profile too, and keeps the referenced photo', async () => {
    const { client, removed } = fake({
      mediaRows: [{ storage_path: 'artist-1/profile/me.jpg' }],
      byPrefix: {
        'artist-1/profile': [
          { name: 'me.jpg', created_at: OLD },
          { name: 'stale.jpg', created_at: OLD },
        ],
      },
    })
    await gcMediaObjects(client, 'artist-1')
    expect(removed).toEqual(['artist-1/profile/stale.jpg'])
  })

  // Review 2 (2026-09-24): PostgREST caps a read at max-rows (1000) and says nothing — the
  // rest simply is not in `data`. Every row past the cap then looked unreferenced, so an
  // artist with more than 1000 media rows would have LIVE files swept. listContent refuses
  // a short read for the same reason; the sweep now does too.
  describe('a truncated media read sweeps NOTHING', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ storage_path: `artist-1/gallery/p${i}.jpg` }))
    const listing = (n: number) => ({
      'artist-1/gallery': [
        ...Array.from({ length: n }, (_, i) => ({ name: `p${i}.jpg`, created_at: OLD })),
        { name: 'orphan.jpg', created_at: OLD },
      ],
    })

    it('CRITICAL: 1000 rows back of 1500 → no object is removed (the other 500 are live)', async () => {
      const rows = many(1500)
      const { client, removed } = fake({ mediaRows: rows.slice(0, 1000), mediaCount: 1500, byPrefix: listing(1500) })
      await gcMediaObjects(client, 'artist-1')
      expect(removed).toEqual([])
    })

    it('the witness: the same artist read in full sweeps only the orphan', async () => {
      const { client, removed } = fake({ mediaRows: many(1500), byPrefix: listing(1500) })
      await gcMediaObjects(client, 'artist-1')
      expect(removed).toEqual(['artist-1/gallery/orphan.jpg'])
    })

    it('no count at all is not "complete" — nothing is removed', async () => {
      const { client, removed } = fake({ mediaRows: [], mediaCount: null, byPrefix: listing(0) })
      await gcMediaObjects(client, 'artist-1')
      expect(removed).toEqual([])
    })

    it('the read asks the server for an exact count (without it, a short read cannot be seen)', async () => {
      const { client, selectOpts } = fake({ mediaRows: [] })
      await gcMediaObjects(client, 'artist-1')
      expect(selectOpts.media).toMatchObject({ count: 'exact' })
    })
  })

  it('never touches another artist\'s folders', async () => {
    const { client, removed, listedPrefixes } = fake({
      mediaRows: [],
      byPrefix: { 'artist-2/gallery': [{ name: 'theirs.jpg', created_at: OLD }] },
    })
    await gcMediaObjects(client, 'artist-1')
    expect(listedPrefixes.every((p) => p.startsWith('artist-1/'))).toBe(true)
    expect(removed).toEqual([])
  })
})
