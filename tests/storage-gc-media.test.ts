/**
 * Media object GC (review finding #1). A gallery photo removed in the editor is a DRAFT
 * change; its Storage object must NOT be destroyed while a published revision still
 * references it (the live site serves media from revision snapshots), or the live site
 * breaks and the file is unrecoverable. `gcDeletedMediaObject` removes the object only
 * when the media was never published; `gcMediaObjects` sweeps orphans at publish time.
 * Fake Supabase client — pure behavior, no live DB.
 */
import { describe, expect, it } from 'vitest'
import { gcDeletedMediaObject, gcMediaObjects } from '@/lib/storage-gc'

type ListObj = { name: string; created_at: string | null }
function fake(opts: { revCount?: number; mediaRows?: { storage_path: string }[]; listObjs?: ListObj[] } = {}) {
  const { revCount = 0, mediaRows = [], listObjs = [] } = opts
  const removed: string[] = []
  const listedPrefixes: string[] = []
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
      return {
        select: () =>
          table === 'revisions' ? thenable({ count: revCount }) : thenable({ data: mediaRows }),
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
            return Promise.resolve({ data: listObjs })
          },
        }
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
  return { client, removed, listedPrefixes }
}

const OLD = new Date(Date.now() - 60 * 60 * 1000).toISOString() // 1h ago (past the age gate)

describe('gcDeletedMediaObject', () => {
  it('KEEPS the object when the media was published (a revision references it)', async () => {
    const { client, removed } = fake({ revCount: 1 })
    await gcDeletedMediaObject(client, 'm1', 'artist-1/gallery/a.jpg')
    expect(removed).toEqual([]) // live site still serves it from its snapshot
  })

  it('removes the object when the media was never published (draft-only)', async () => {
    const { client, removed } = fake({ revCount: 0 })
    await gcDeletedMediaObject(client, 'm1', 'artist-1/gallery/a.jpg')
    expect(removed).toEqual(['artist-1/gallery/a.jpg'])
  })

  it('no-ops without a storage path', async () => {
    const { client, removed } = fake({ revCount: 0 })
    await gcDeletedMediaObject(client, 'm1', null)
    expect(removed).toEqual([])
  })
})

describe('gcMediaObjects (publish-time sweep of the gallery folder)', () => {
  it('removes old unreferenced objects, keeps referenced ones', async () => {
    const { client, removed, listedPrefixes } = fake({
      mediaRows: [{ storage_path: 'artist-1/gallery/keep.jpg' }],
      listObjs: [
        { name: 'keep.jpg', created_at: OLD },
        { name: 'orphan.jpg', created_at: OLD },
      ],
    })
    await gcMediaObjects(client, 'artist-1')
    expect(listedPrefixes).toContain('artist-1/gallery')
    expect(removed).toEqual(['artist-1/gallery/orphan.jpg'])
  })

  it('leaves a just-uploaded (fresh) unreferenced object alone (age gate)', async () => {
    const { client, removed } = fake({
      mediaRows: [],
      listObjs: [{ name: 'fresh.jpg', created_at: new Date().toISOString() }],
    })
    await gcMediaObjects(client, 'artist-1')
    expect(removed).toEqual([])
  })
})
