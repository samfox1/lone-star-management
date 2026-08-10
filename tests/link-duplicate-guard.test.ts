/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * ONE LINK PER PLATFORM — enforced where the row is WRITTEN, not where it is offered.
 *
 * Sam, 2026-08-10: "make sure to add a checker that a social cant be added to the same
 * section twice." The editor's picker already disables a platform that is present, but
 * that guard is presentation: it reads a list rendered a moment ago, so a second tab, a
 * stale panel, or a double-submit walks straight past it.
 *
 * Two rows labelled "Instagram" render two identical icons in the socials row that a
 * manager cannot tell apart — and because the frame addresses a social BY LABEL
 * (`item:link:instagram`), a duplicate makes the frame→panel select ambiguous too.
 */
import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createContent } from '@/lib/content'

/** A stub of just the two chains createContent uses: a select of existing labels, and
 *  the insert. `existing` is what the links table already holds. */
function fakeClient(existing: { label: string }[]) {
  const inserts: Record<string, unknown>[] = []
  const client = {
    from: () => {
      const b: any = {
        select: () => b,
        eq: () => b,
        insert: (values: Record<string, unknown>) => {
          inserts.push(values)
          return { select: () => ({ single: () => Promise.resolve({ data: { id: 'new' }, error: null }) }) }
        },
        single: () => Promise.resolve({ data: { id: 'new' }, error: null }),
        then: (res: (v: { data: { label: string }[]; error: null }) => unknown) =>
          Promise.resolve({ data: existing, error: null }).then(res),
      }
      return b
    },
  } as unknown as SupabaseClient
  return { client, inserts }
}

describe('a social cannot be added to the same site twice', () => {
  it('CRITICAL: a duplicate label is REFUSED, and nothing is inserted', async () => {
    const { client, inserts } = fakeClient([{ label: 'Instagram' }])
    await expect(createContent(client, 'link', 'a1', { label: 'Instagram', url: 'https://ig/2' })).rejects.toThrow(
      /already on this site/i,
    )
    // Row state, not the return value: a guard that throws AFTER writing has still
    // written (AGENTS.md rule 3's cousin).
    expect(inserts).toHaveLength(0)
  })

  it('CRITICAL: compared on the SAME normalization the frame joins on', async () => {
    // The marker is the label lowercased, so "instagram" and "Instagram " address the
    // very same element. A case-sensitive check would let both rows exist and leave the
    // select pointing at whichever came first.
    const { client, inserts } = fakeClient([{ label: 'Instagram' }])
    await expect(createContent(client, 'link', 'a1', { label: '  instagram ', url: 'https://ig/2' })).rejects.toThrow()
    expect(inserts).toHaveLength(0)
  })

  it('a DIFFERENT platform still goes in', async () => {
    // The negative above is only meaningful beside this: a guard that refused everything
    // would pass it and break the feature.
    const { client, inserts } = fakeClient([{ label: 'Instagram' }])
    await createContent(client, 'link', 'a1', { label: 'TikTok', url: 'https://tt/1' })
    expect(inserts).toHaveLength(1)
    expect(inserts[0]).toMatchObject({ label: 'TikTok', artist_id: 'a1' })
  })

  it('an artist with no links yet can add their first', async () => {
    const { client, inserts } = fakeClient([])
    await createContent(client, 'link', 'a1', { label: 'Instagram', url: 'https://ig/1' })
    expect(inserts).toHaveLength(1)
  })

  it('a blank label is left to the column constraints, not swallowed here', async () => {
    // socialSlug('') is empty and matches nothing; refusing here would turn a NOT NULL
    // violation into a confusing "already on this site".
    const { client, inserts } = fakeClient([{ label: 'Instagram' }])
    await createContent(client, 'link', 'a1', { label: '', url: 'https://x' })
    expect(inserts).toHaveLength(1)
  })
})
