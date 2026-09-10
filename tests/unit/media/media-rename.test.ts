/**
 * renameMedia — descriptive file names (SEO_GEO_PLAN B6b). A fake client pins the ORDER
 * (copy, then row; remove the copy if the row fails). DB-free, so it stays in the
 * mutation slice; the live half is tests/media-rename-live.test.ts.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { renameMedia, slugStoragePath } from '@/lib/media-rename'

const A = '1f2a969b-cb1c-493c-851f-647581a3e4ab'
const OLD = `${A}/gallery/11111111-1111-4111-8111-111111111111.jpg`

function fake(opts: { copyErr?: string; rowErr?: { code?: string; message: string } } = {}) {
  const calls: string[] = []
  const client = {
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ single: async () => ({ data: { storage_path: OLD, slug: null }, error: null }) }) }) }),
      update: (v: Record<string, unknown>) => ({
        eq: () => ({
          eq: async () => {
            calls.push(`update:${v.storage_path}:${v.slug}`)
            return { error: opts.rowErr ?? null }
          },
        }),
      }),
    }),
    storage: {
      from: () => ({
        copy: async (from: string, to: string) => {
          calls.push(`copy:${from}->${to}`)
          return { error: opts.copyErr ? { message: opts.copyErr } : null }
        },
        remove: async (paths: string[]) => {
          calls.push(`remove:${paths.join(',')}`)
          return { error: null }
        },
      }),
    },
  } as unknown as SupabaseClient
  return { client, calls }
}

describe('renameMedia (fake client: order + rollback)', () => {
  it('copies FIRST, then points the row at the copy', async () => {
    const { client, calls } = fake()
    const r = await renameMedia(client, A, 'm1', 'Skeen Tour ')
    expect(r).toEqual({ storage_path: `${A}/gallery/skeen-tour.jpg` })
    expect(calls).toEqual([`copy:${OLD}->${A}/gallery/skeen-tour.jpg`, `update:${A}/gallery/skeen-tour.jpg:skeen-tour`])
  })

  it('CRITICAL: a failed row write REMOVES the copy — a rename never leaves an orphan', async () => {
    const { client, calls } = fake({ rowErr: { code: '23505', message: 'duplicate key' } })
    const r = await renameMedia(client, A, 'm1', 'skeen-tour')
    expect(r.error).toBe('That file name is taken.')
    expect(calls.at(-1)).toBe(`remove:${A}/gallery/skeen-tour.jpg`)
  })

  it('rejects an unusable name before touching storage', async () => {
    const { client, calls } = fake()
    expect((await renameMedia(client, A, 'm1', ' — !! ')).error).toBeTruthy()
    expect(calls).toEqual([])
  })

  it('slugStoragePath keeps folder + extension', () => {
    expect(slugStoragePath(OLD, 'skeen-tour')).toBe(`${A}/gallery/skeen-tour.jpg`)
  })
})
