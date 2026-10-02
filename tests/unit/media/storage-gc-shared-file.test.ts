// A deleted photo's file stays while another row, or another row's published version, still names it.
/**
 * ONE FILE, TWO ROWS (PROFILE_TOOL_PLAN.md, 2026-10-02). A profile photo picked from Images is a
 * second `media` row naming the SAME file as the library photo (lib/profile-photo.ts). So
 * deleting either row must not take the file with it: the delete-time GC
 * (`gcDeletedMediaObject`) used to ask only "was THIS row ever published?", and a never-published
 * library photo deleted from Images would have removed the file the profile photo still shows.
 *
 * Code:     src/lib/storage-gc.ts (gcDeletedMediaObject → stillNamed)
 * Tier:     STRICT (AGENTS.md "Test depth"): storage GC, data that can be lost.
 * Covers:   • another working media row names the file: kept
 *           • another row's PUBLISHED snapshot names it (the live site may serve it): kept
 *           • a failed or unknown check: kept (a failed count is "unknown", not "nothing")
 *           • nothing else names it and the row was never published: removed, as before
 *           • the two halves of a logo (file + original) are judged one by one
 * Fake:     answers each count by the filters the query carried, so an assertion lands on the
 *           question asked, not on a canned number.
 */
import { describe, expect, it } from 'vitest'
import { gcDeletedMediaObject } from '@/lib/storage-gc'

const FILE = 'artist-1/gallery/a.jpg'

type Counts = {
  /** Other media rows naming the path, by path. */
  rows?: Record<string, number | null>
  /** Media snapshots naming the path, by path. */
  snaps?: Record<string, number | null>
  /** Revisions of the deleted row itself. */
  own?: number
  /** Make this table's reads fail. */
  fail?: 'media' | 'revisions'
}

function fake(c: Counts = {}) {
  const removed: string[] = []
  const client = {
    from(table: string) {
      const eq: Record<string, unknown> = {}
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (col: string, val: unknown) => ((eq[col] = val), q),
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
          let out: { count: number | null; error: { message: string } | null }
          if (c.fail === table) out = { count: null, error: { message: 'down' } }
          else if (table === 'media') out = { count: c.rows?.[eq.storage_path as string] ?? 0, error: null }
          else if ('data->>storage_path' in eq) out = { count: c.snaps?.[eq['data->>storage_path'] as string] ?? 0, error: null }
          else out = { count: c.own ?? 0, error: null }
          return Promise.resolve(out).then(res, rej)
        },
      }
      return q
    },
    storage: {
      from: () => ({
        remove: (paths: string[]) => {
          removed.push(...paths)
          return Promise.resolve({ error: null })
        },
      }),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
  return { client, removed }
}

describe('gcDeletedMediaObject: a file another row names', () => {
  it('sanity: nothing else names it and the row was never published, so it goes', async () => {
    const { client, removed } = fake()
    await gcDeletedMediaObject(client, 'm1', FILE)
    expect(removed).toEqual([FILE])
  })

  // The bug this guards: delete the library photo, the profile photo loses its file.
  it('CRITICAL: another media row still names the file (the profile photo picked from Images): kept', async () => {
    const { client, removed } = fake({ rows: { [FILE]: 1 } })
    await gcDeletedMediaObject(client, 'm1', FILE)
    expect(removed).toEqual([])
  })

  // The profile row was replaced in draft but its published snapshot is still the live photo.
  it('CRITICAL: another row’s published snapshot names the file (the live site may serve it): kept', async () => {
    const { client, removed } = fake({ snaps: { [FILE]: 2 } })
    await gcDeletedMediaObject(client, 'm1', FILE)
    expect(removed).toEqual([])
  })

  it('CRITICAL: a check that fails keeps the file', async () => {
    for (const fail of ['media', 'revisions'] as const) {
      const { client, removed } = fake({ fail })
      await gcDeletedMediaObject(client, 'm1', FILE)
      expect(removed, fail).toEqual([])
    }
  })

  it('a logo’s file and original are judged one by one', async () => {
    const original = 'artist-1/brand/original.png'
    const { client, removed } = fake({ rows: { [FILE]: 1 } })
    await gcDeletedMediaObject(client, 'm1', FILE, original)
    expect(removed).toEqual([original])
  })

  it('the row’s own published history still keeps it, as before', async () => {
    const { client, removed } = fake({ own: 1 })
    await gcDeletedMediaObject(client, 'm1', FILE)
    expect(removed).toEqual([])
  })
})
