/**
 * Font object GC.
 *
 * Replacing a font uploads a new object and repoints the row; without a sweep the old
 * file sits in a PUBLIC bucket, referenced by nothing and collected by nobody, forever.
 * That is not hypothetical — the brand folder leaked exactly this way until its folder
 * was added to the media sweep.
 *
 * The hard part is what must be KEPT. Fonts are publish-gated, so a font removed from
 * the working table can still be named by the PUBLISHED stylesheet a fan's browser is
 * fetching right now. Deleting that object takes the site's typeface away with no error
 * anywhere and no way to recover the file. So `referenced` is the union of working rows
 * and live published revisions, which is also what makes the sweep safe to call at
 * delete time rather than only after a publish.
 *
 * Fake Supabase client — pure behaviour, no live DB.
 */
import { describe, expect, it } from 'vitest'
import { gcFontObjects } from '@/lib/storage-gc'

type ListObj = { name: string; created_at: string | null }

function fake(opts: {
  working?: { storage_path: string }[]
  revisions?: { data: { storage_path?: string; _deleted?: string } }[]
  objects?: ListObj[]
}) {
  const { working = [], revisions = [], objects = [] } = opts
  const removed: string[] = []
  const buckets: string[] = []
  const tables: string[] = []
  const thenable = (result: unknown): Record<string, unknown> => {
    const p: Record<string, unknown> = {
      select: () => p,
      eq: () => p,
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej),
    }
    return p
  }
  const client = {
    from(table: string) {
      tables.push(table)
      return {
        select: () => (table === 'revisions' ? thenable({ data: revisions }) : thenable({ data: working })),
      }
    },
    storage: {
      from(bucket: string) {
        buckets.push(bucket)
        return {
          remove: (paths: string[]) => {
            removed.push(...paths)
            return Promise.resolve({ error: null })
          },
          list: () => Promise.resolve({ data: objects }),
        }
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
  return { client, removed, buckets, tables }
}

const OLD = new Date(Date.now() - 60 * 60 * 1000).toISOString() // past the age gate
const NEW = new Date().toISOString()
const A = 'artist-1'

describe('gcFontObjects', () => {
  it('sweeps an object no working row and no revision points at', async () => {
    const { client, removed } = fake({
      working: [{ storage_path: `${A}/fonts/keep.woff2` }],
      objects: [
        { name: 'keep.woff2', created_at: OLD },
        { name: 'stray.woff2', created_at: OLD },
      ],
    })
    await gcFontObjects(client, A)
    expect(removed).toEqual([`${A}/fonts/stray.woff2`])
  })

  it('CRITICAL: KEEPS an object a published revision still names', async () => {
    // The font was removed from the working table but the removal is not published yet.
    // The live stylesheet still points at this URL.
    const { client, removed } = fake({
      working: [],
      revisions: [{ data: { storage_path: `${A}/fonts/live.woff2` } }],
      objects: [{ name: 'live.woff2', created_at: OLD }],
    })
    await gcFontObjects(client, A)
    expect(removed).toEqual([])
  })

  it('CRITICAL: keeps a freshly uploaded object — the row lands after the file', async () => {
    // performUpload writes the object BEFORE its row, so a just-uploaded font looks
    // unreferenced for a moment. Without the age gate, a sweep in that window deletes
    // the file the manager is still watching upload.
    const { client, removed } = fake({ working: [], objects: [{ name: 'justnow.woff2', created_at: NEW }] })
    await gcFontObjects(client, A)
    expect(removed).toEqual([])
  })

  it('reads the FONTS bucket, not media', async () => {
    // The fonts folder is deliberately absent from MEDIA_FOLDERS: it is a different
    // bucket, and sweeping `media/{artist}/fonts` would silently collect nothing.
    const { client, buckets, tables } = fake({ objects: [] })
    await gcFontObjects(client, A)
    expect(buckets).toContain('fonts')
    expect(buckets).not.toContain('media')
    expect(tables).toContain('artist_fonts')
    expect(tables).toContain('revisions')
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
    const { client, removed } = fake({ working: [], objects: [{ name: 'stray.woff2', created_at: OLD }] })
    await gcFontObjects(client, A)
    for (const path of removed) expect(path.startsWith(`${A}/`)).toBe(true)
  })
})
