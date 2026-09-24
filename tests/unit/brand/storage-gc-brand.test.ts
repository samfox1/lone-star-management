// A cut-out logo keeps its original file, and a failed read never turns into "delete it all".
/**
 * Storage GC and the Brand page (BRAND_PAGE_PLAN.md, "Data model").
 *
 * TWO THINGS, both about what the sweeps must KEEP.
 *
 * 1. `media.source_path`. "Remove background" swaps a logo's `storage_path` for the cut-out
 *    and keeps the ORIGINAL in `source_path`. The publish-time sweep keeps only objects a
 *    working row references; if it read `storage_path` alone, the original would be swept at
 *    the next publish and the cut-out could never be undone.
 *
 * 2. A FAILED READ. Every sweep builds `referenced` from a table read and deletes whatever
 *    is old and not in it. supabase-js does not throw on a failed read, it hands back
 *    `{ data: null, error }` — and the sweeps used to read that as "no rows", which makes
 *    EVERY object older than the age gate collectable. One network blip during publish, or
 *    one select naming a column the database does not have yet, and the artist's whole media
 *    folder goes. So an error on the reference side must sweep nothing.
 *
 * Fake client, no database: each table read answers with the rows or the error it is given.
 */
import { describe, expect, it } from 'vitest'
import { gcDeletedMediaObject, gcFontObjects, gcMediaObjects, gcVideoObjects } from '@/lib/storage-gc'

type ListObj = { name: string; created_at: string | null }
type Read = { data?: unknown[] | null; error?: { message: string } | null; count?: number }

const OLD = new Date(Date.now() - 60 * 60 * 1000).toISOString() // past the 15-minute age gate
const A = 'artist-1'

function fake(opts: { reads?: Record<string, Read>; byPrefix?: Record<string, ListObj[]> }) {
  const { reads = {}, byPrefix = {} } = opts
  const removed: string[] = []
  const buckets: string[] = []
  const selected: Record<string, string> = {}
  const thenable = (result: Read): Record<string, unknown> => {
    const p: Record<string, unknown> = {
      eq: () => p,
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve({ data: null, error: null, ...result }).then(res, rej),
    }
    return p
  }
  const client = {
    from(table: string) {
      return {
        select: (cols: string) => {
          selected[table] = cols
          return thenable(reads[table] ?? { data: [] })
        },
      }
    },
    storage: {
      from(bucket: string) {
        return {
          remove: (paths: string[]) => {
            buckets.push(bucket)
            removed.push(...paths)
            return Promise.resolve({ error: null })
          },
          list: (prefix: string) => Promise.resolve({ data: byPrefix[prefix] ?? [] }),
        }
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
  return { client, removed, selected, buckets }
}

describe('gcMediaObjects keeps a cut-out logo’s original', () => {
  it('CRITICAL: an object named only by a row’s source_path survives the sweep', async () => {
    const { client, removed } = fake({
      reads: {
        media: {
          data: [{ storage_path: `${A}/brand/cutout.png`, source_path: `${A}/brand/original.png` }],
        },
      },
      byPrefix: {
        [`${A}/brand`]: [
          { name: 'cutout.png', created_at: OLD },
          { name: 'original.png', created_at: OLD },
          { name: 'stray.png', created_at: OLD },
        ],
      },
    })
    await gcMediaObjects(client, A)
    // The stray proves the sweep ran at all; without it, "original kept" is true of a no-op.
    expect(removed).toEqual([`${A}/brand/stray.png`])
  })

  it('reads source_path from the media rows (the column the Brand page writes)', async () => {
    const { client, selected } = fake({ reads: { media: { data: [] } } })
    await gcMediaObjects(client, A)
    expect(selected.media).toContain('source_path')
  })
})

describe('a failed reference read sweeps NOTHING', () => {
  const everythingOld = {
    [`${A}/gallery`]: [{ name: 'photo.jpg', created_at: OLD }],
    [`${A}/brand`]: [{ name: 'logo.png', created_at: OLD }],
    [`${A}/videos`]: [{ name: 'clip.mp4', created_at: OLD }],
    [`${A}/fonts`]: [{ name: 'face.woff2', created_at: OLD }],
  }
  const failed = { data: null, error: { message: 'column media.source_path does not exist' } }

  it('CRITICAL: gcMediaObjects', async () => {
    const { client, removed } = fake({ reads: { media: failed }, byPrefix: everythingOld })
    await gcMediaObjects(client, A)
    expect(removed).toEqual([])
  })

  it('the same sweep DOES remove those objects when the read succeeds (the witness)', async () => {
    const { client, removed, buckets } = fake({ reads: { media: { data: [] } }, byPrefix: everythingOld })
    await gcMediaObjects(client, A)
    expect(removed.sort()).toEqual([`${A}/brand/logo.png`, `${A}/gallery/photo.jpg`])
    expect(buckets).toEqual(['media'])
  })

  it('CRITICAL: gcVideoObjects', async () => {
    const { client, removed } = fake({ reads: { videos: failed }, byPrefix: everythingOld })
    await gcVideoObjects(client, A)
    expect(removed).toEqual([])
    const ok = fake({ reads: { videos: { data: [] } }, byPrefix: everythingOld })
    await gcVideoObjects(ok.client, A)
    expect(ok.removed).toEqual([`${A}/videos/clip.mp4`])
  })

  it('CRITICAL: gcFontObjects — a failed WORKING read', async () => {
    const { client, removed } = fake({ reads: { artist_fonts: failed, revisions: { data: [] } }, byPrefix: everythingOld })
    await gcFontObjects(client, A)
    expect(removed).toEqual([])
  })

  it('CRITICAL: gcFontObjects — a failed PUBLISHED read (the live stylesheet still names the file)', async () => {
    const { client, removed } = fake({ reads: { artist_fonts: { data: [] }, revisions: failed }, byPrefix: everythingOld })
    await gcFontObjects(client, A)
    expect(removed).toEqual([])
    const ok = fake({ reads: { artist_fonts: { data: [] }, revisions: { data: [] } }, byPrefix: everythingOld })
    await gcFontObjects(ok.client, A)
    expect(ok.removed).toEqual([`${A}/fonts/face.woff2`])
  })
})

describe('gcDeletedMediaObject takes the original with it', () => {
  it('CRITICAL: a never-published logo loses BOTH files at delete — from the media bucket', async () => {
    const { client, removed, buckets } = fake({ reads: { revisions: { count: 0 } } })
    await gcDeletedMediaObject(client, 'm1', `${A}/brand/cutout.png`, `${A}/brand/original.png`)
    expect(removed.sort()).toEqual([`${A}/brand/cutout.png`, `${A}/brand/original.png`])
    expect(buckets).toEqual(['media'])
  })

  it('no file at all → not even the revision count is asked for', async () => {
    const { client, removed, selected } = fake({ reads: { revisions: { count: 0 } } })
    await gcDeletedMediaObject(client, 'm1', null, null)
    expect(removed).toEqual([])
    expect(selected.revisions).toBeUndefined()
  })

  it('CRITICAL: a published logo keeps both (the live site may still serve the original)', async () => {
    // Published before the cut-out: the revision names what is now source_path.
    const { client, removed } = fake({ reads: { revisions: { count: 1 } } })
    await gcDeletedMediaObject(client, 'm1', `${A}/brand/cutout.png`, `${A}/brand/original.png`)
    expect(removed).toEqual([])
  })

  it('without an original, only the file itself goes (the old call shape)', async () => {
    const { client, removed } = fake({ reads: { revisions: { count: 0 } } })
    await gcDeletedMediaObject(client, 'm1', `${A}/gallery/a.jpg`)
    expect(removed).toEqual([`${A}/gallery/a.jpg`])
  })

  it('a failed revision count keeps the files (unknown is not "never published")', async () => {
    const { client, removed } = fake({ reads: { revisions: { count: undefined, error: { message: 'boom' } } } })
    await gcDeletedMediaObject(client, 'm1', `${A}/brand/cutout.png`, `${A}/brand/original.png`)
    expect(removed).toEqual([])
  })
})
