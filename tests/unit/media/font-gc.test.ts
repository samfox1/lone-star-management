// Sweeping up the old font file when a font is replaced, so nothing is orphaned in a public
//   bucket — and never sweeping a file a short or failed read can't yet account for.
/**
 * Font object GC.
 *
 * Replacing a font uploads a new object and repoints the row; without a sweep the old
 * file sits in a PUBLIC bucket, referenced by nothing and collected by nobody, forever.
 * That is not hypothetical — the brand folder leaked exactly this way until its folder
 * was added to the media sweep.
 *
 * The hard part is what must be KEPT: the union of WORKING rows and the LATEST
 * non-tombstoned PUBLISHED revision per font (`latest_revisions`, mirrors gcMediaObjects
 * 2026-09-28) — never every historical revision. A font published once, then replaced and
 * republished many times over, used to keep EVERY file forever (a plain, uncounted select
 * over the whole `revisions` log); only the latest can ever matter, because neither restore
 * path can reach further back: `restoreToPublished` (the editor's arbitrary-moment Restore
 * version) excludes `artist_font` from `EDITOR_RESTORE` entirely ("No brand revert for
 * now — the Brand page has its own"), and the Brand page's own revert
 * (`restoreBrandToPublished`) only ever goes back to the LATEST publish. So "keep the
 * latest" is not a narrower guess than before — it is everything either restore path can
 * ever need.
 *
 * Both halves are read with an EXACT count: a failed read is not "no rows" (that swept a
 * live file on a network blip), and a SHORT read is not "all of it" — PostgREST caps an
 * unbounded read at max-rows (1000) with no word, so an artist with more historical font
 * revisions than that had every row past the cap read as unreferenced and its LIVE file
 * swept, silently, with no way even to notice. Either half being incomplete sweeps NOTHING.
 *
 * Fake Supabase client — pure behaviour, no live DB.
 */
import { describe, expect, it } from 'vitest'
import { gcFontObjects } from '@/lib/storage-gc'

type ListObj = { name: string; created_at: string | null }
type Read = { data?: unknown[] | null; error?: { message: string } | null; count?: number | null }

function fake(opts: { working?: Read; published?: Read; byPrefix?: Record<string, ListObj[]> } = {}) {
  const { working = { data: [], count: 0 }, published = { data: [], count: 0 }, byPrefix = {} } = opts
  const removed: string[] = []
  const listedPrefixes: string[] = []
  const buckets: string[] = []
  const tables: string[] = []
  const rpcs: { name: string; args: unknown; opts: unknown; eq: [string, unknown][] }[] = []
  const selectOpts: Record<string, unknown> = {}
  const thenable = (result: Read, eqs?: [string, unknown][]): Record<string, unknown> => {
    const p: Record<string, unknown> = {
      eq: (col: string, val: unknown) => {
        eqs?.push([col, val])
        return p
      },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve({ data: null, error: null, ...result }).then(res, rej),
    }
    return p
  }
  const client = {
    from(table: string) {
      tables.push(table)
      return {
        select: (_cols?: string, o?: unknown) => {
          selectOpts[table] = o
          return thenable(working)
        },
      }
    },
    rpc(name: string, args: unknown, o?: unknown) {
      const call = { name, args, opts: o, eq: [] as [string, unknown][] }
      rpcs.push(call)
      return thenable(published, call.eq)
    },
    storage: {
      from(bucket: string) {
        buckets.push(bucket)
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
  return { client, removed, listedPrefixes, buckets, tables, rpcs, selectOpts }
}

const OLD = new Date(Date.now() - 60 * 60 * 1000).toISOString() // past the age gate
const NEW = new Date().toISOString()
const A = 'artist-1'

describe('gcFontObjects', () => {
  it('sweeps an object no working row and no live revision names', async () => {
    const { client, removed } = fake({
      working: { data: [{ storage_path: `${A}/fonts/keep.woff2` }], count: 1 },
      byPrefix: {
        [`${A}/fonts`]: [
          { name: 'keep.woff2', created_at: OLD },
          { name: 'stray.woff2', created_at: OLD },
        ],
      },
    })
    await gcFontObjects(client, A)
    expect(removed).toEqual([`${A}/fonts/stray.woff2`])
  })

  it('CRITICAL: a font removed in draft but still live survives', async () => {
    // The font was deleted from the working table but that deletion is not published yet
    // (or the Brand page has no revert path back further than the last publish) — the
    // live stylesheet still points at this URL.
    const { client, removed } = fake({
      working: { data: [], count: 0 },
      published: { data: [{ data: { storage_path: `${A}/fonts/live.woff2` } }], count: 1 },
      byPrefix: { [`${A}/fonts`]: [{ name: 'live.woff2', created_at: OLD }] },
    })
    await gcFontObjects(client, A)
    expect(removed).toEqual([])
  })

  it('CRITICAL: a font no row or live revision names is swept (a tombstone names nothing)', async () => {
    // Deleted AND published: the tombstone (`{ _deleted: true }`) names no file, so the
    // font it took off the site is a true orphan, same as gcMediaObjects.
    const { client, removed } = fake({
      working: { data: [], count: 0 },
      published: { data: [{ data: { _deleted: true } }], count: 1 },
      byPrefix: { [`${A}/fonts`]: [{ name: 'gone.woff2', created_at: OLD }] },
    })
    await gcFontObjects(client, A)
    expect(removed).toEqual([`${A}/fonts/gone.woff2`])
  })

  it('CRITICAL: keeps a freshly uploaded object — the row lands after the file', async () => {
    // performUpload writes the object BEFORE its row, so a just-uploaded font looks
    // unreferenced for a moment. Without the age gate, a sweep in that window deletes
    // the file the manager is still watching upload.
    const { client, removed } = fake({ byPrefix: { [`${A}/fonts`]: [{ name: 'justnow.woff2', created_at: NEW }] } })
    await gcFontObjects(client, A)
    expect(removed).toEqual([])
  })

  it('reads the FONTS bucket and the latest revision per font, with an exact count both sides', async () => {
    // The fonts folder is deliberately absent from MEDIA_FOLDERS: it is a different
    // bucket, and sweeping `media/{artist}/fonts` would silently collect nothing.
    const { client, buckets, tables, rpcs, selectOpts } = fake()
    await gcFontObjects(client, A)
    expect(buckets).toContain('fonts')
    expect(buckets).not.toContain('media')
    expect(tables).toContain('artist_fonts')
    expect(tables).not.toContain('revisions') // the RPC replaces reading the whole log
    expect(selectOpts.artist_fonts).toMatchObject({ count: 'exact' })
    expect(rpcs).toEqual([
      { name: 'latest_revisions', args: { p_artist_id: A }, opts: { count: 'exact' }, eq: [['entity_type', 'artist_font']] },
    ])
  })

  it('never throws — a failed sweep must not fail the delete that triggered it', async () => {
    const broken = {
      from() {
        throw new Error('network')
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any
    await expect(gcFontObjects(broken, A)).resolves.toBeUndefined()
  })

  it('scopes every path to the artist folder — it can never reach another tenant', async () => {
    const { client, removed } = fake({ byPrefix: { [`${A}/fonts`]: [{ name: 'stray.woff2', created_at: OLD }] } })
    await gcFontObjects(client, A)
    for (const path of removed) expect(path.startsWith(`${A}/`)).toBe(true)
  })

  // A failed OR short read on either half must sweep NOTHING: an unknown reference set is
  // not an empty one (review 2, 2026-09-24, the same finding gcMediaObjects carries).
  describe('a failed or short read sweeps NOTHING', () => {
    const stray = { [`${A}/fonts`]: [{ name: 'stray.woff2', created_at: OLD }] }

    it('CRITICAL: a failed WORKING read', async () => {
      const { client, removed } = fake({ working: { data: null, error: { message: 'boom' } }, byPrefix: stray })
      await gcFontObjects(client, A)
      expect(removed).toEqual([])
    })

    it('CRITICAL: a failed PUBLISHED read (the live stylesheet may still name the file)', async () => {
      const { client, removed } = fake({ published: { data: null, error: { message: 'boom' } }, byPrefix: stray })
      await gcFontObjects(client, A)
      expect(removed).toEqual([])
    })

    it('CRITICAL: a truncated WORKING read (1000 rows back of 1500) sweeps nothing', async () => {
      const rows = Array.from({ length: 1000 }, (_, i) => ({ storage_path: `${A}/fonts/p${i}.woff2` }))
      const { client, removed } = fake({ working: { data: rows, count: 1500 }, byPrefix: stray })
      await gcFontObjects(client, A)
      expect(removed).toEqual([])
    })

    it('CRITICAL: a truncated PUBLISHED read (the rows past the cap are live too) sweeps nothing', async () => {
      const rows = [{ data: { storage_path: `${A}/fonts/live.woff2` } }]
      const { client, removed } = fake({ published: { data: rows, count: 1500 }, byPrefix: stray })
      await gcFontObjects(client, A)
      expect(removed).toEqual([])
    })

    it('no count at all is not "complete" on either side', async () => {
      const { client: c1, removed: r1 } = fake({ working: { data: [], count: undefined }, byPrefix: stray })
      await gcFontObjects(c1, A)
      expect(r1).toEqual([])

      const { client: c2, removed: r2 } = fake({ published: { data: [], count: undefined }, byPrefix: stray })
      await gcFontObjects(c2, A)
      expect(r2).toEqual([])
    })

    it('the witness: the same artist read in full sweeps the stray', async () => {
      const { client, removed } = fake({ byPrefix: stray })
      await gcFontObjects(client, A)
      expect(removed).toEqual([`${A}/fonts/stray.woff2`])
    })
  })
})
