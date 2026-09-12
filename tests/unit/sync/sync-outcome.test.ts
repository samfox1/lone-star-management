// A pull tells the manager what it did, including the parts that failed.
/**
 * A PULL REPORTS WHAT IT DID, INCLUDING WHAT IT COULD NOT DO.
 *
 * `syncExternal` has always returned a `SyncResult` with `failed` and per-item `errors`.
 * Almost every action threw it away and returned a bare `{ ok: true }` — so a pull where
 * three products collided on a unique index looked exactly like a clean one, and
 * MERCH_PLAN's known-gaps list has two bugs that are invisible for precisely this reason
 * ("a handle swap between two products fails one row"; "reconnecting to a different store
 * leaves stale rows"). Only `syncShopifyAction` reported it, in its own hand-rolled prose.
 *
 * One helper now, so every source says the same thing the same way — and so the sync
 * dialog can show a per-source line without each action having invented its own wording.
 */
import { describe, expect, it } from 'vitest'
import { syncOutcome } from '@/lib/sync'
import type { SyncResult } from '@/lib/sync'

const result = (over: Partial<SyncResult> = {}): SyncResult => ({
  added: 0, updated: 0, skipped: 0, merged: 0, failed: 0, errors: [], notes: [], ...over,
})

describe('syncOutcome — what a pull tells the manager', () => {
  // Sam, 2026-09-12: "if there are duplicates, notify me when the sync happens." A count
  // cannot say WHICH song, and the whole value of the notice is the name.
  it('CRITICAL: carries the per-song notes through, so the dialog can name them', () => {
    const notes = [
      { title: 'Rain', kind: 'merged-by-title' as const },
      { title: 'Sun', kind: 'possible-duplicate' as const },
    ]
    expect(syncOutcome(result({ added: 1, merged: 1, notes }), 'song').notes).toEqual(notes)
  })

  it('CRITICAL: a duplicate is reported even when nothing else changed', () => {
    // "Already up to date" is the quiet path, and a pull that added nothing can still
    // have found a twin worth looking at — swallowing it there is how it stays hidden.
    const notes = [{ title: 'Rain', kind: 'possible-duplicate' as const }]
    const out = syncOutcome(result({ skipped: 3, notes }), 'song')
    expect(out).toMatchObject({ ok: true, message: 'Already up to date' })
    expect(out.notes).toEqual(notes)
  })

  it('a clean pull carries no notes', () => {
    expect(syncOutcome(result({ added: 2 }), 'song').notes).toEqual([])
  })

  it('CRITICAL: a partial failure is NOT ok, and says how many landed', () => {
    // The whole point. "12 pulled" over a run where 3 rows never saved is a lie the
    // manager acts on — they publish, and the products are not there.
    const out = syncOutcome(
      result({ added: 9, failed: 3, errors: [{ id: 'a', message: 'duplicate key value violates merch_handle_uniq' }] as never }),
      'product',
    )
    expect(out.ok).toBe(false)
    expect(out.error).toContain('3 products failed')
    expect(out.error, 'the manager cannot tell whether to republish').toContain('9 saved')
    // The first message is the DIAGNOSTIC one — a constraint name is the difference
    // between "retry" and "these rows belong to your old store".
    expect(out.error).toContain('merch_handle_uniq')
  })

  it('CRITICAL: a clean pull reports its COUNTS, not a fixed word', () => {
    // A pull that touched nothing because every row is manual used to look identical to
    // one that imported a whole catalogue.
    const out = syncOutcome(result({ added: 4, updated: 2 }), 'product')
    expect(out.ok).toBe(true)
    expect(out.message).toContain('4 added')
    expect(out.message).toContain('2 updated')
  })

  it('CRITICAL: a pull that changed nothing says so plainly', () => {
    // `0 added, 0 updated` is technically true and reads as a failure. It is the normal
    // outcome of a second pull, and it should read that way.
    const out = syncOutcome(result({ skipped: 7 }), 'product')
    expect(out.ok).toBe(true)
    expect(out.message?.toLowerCase()).toContain('up to date')
  })

  it('mentions what it left alone, and what it merged, only when there is some', () => {
    // Noise control: every source returns `merged: 0` except the track syncs.
    expect(syncOutcome(result({ added: 1, skipped: 3 }), 'song').message).toContain('3 left alone')
    expect(syncOutcome(result({ added: 1, merged: 2 }), 'song').message).toContain('2 merged')
    expect(syncOutcome(result({ added: 1 }), 'song').message).not.toContain('merged')
    expect(syncOutcome(result({ added: 1 }), 'song').message).not.toContain('left alone')
  })

  it('pluralises the noun it is given', () => {
    expect(syncOutcome(result({ failed: 1, errors: [{ id: 'a', message: 'x' }] as never }), 'product').error).toContain('1 product failed')
    expect(syncOutcome(result({ failed: 2, errors: [{ id: 'a', message: 'x' }] as never }), 'product').error).toContain('2 products failed')
    expect(syncOutcome(result({ added: 1 }), 'song').message).toContain('1 added')
  })

  it('CRITICAL: a failure with no error detail still reports the failure', () => {
    // `errors` is empty only if `failed` was set without them, which would be a bug in a
    // sync — but swallowing the count because the detail is missing is worse.
    const out = syncOutcome(result({ added: 1, failed: 2 }), 'product')
    expect(out.ok).toBe(false)
    expect(out.error).toContain('2 products failed')
  })
})
