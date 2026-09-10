// The one query behind the inbox's attachment badge, shared by both inbox pages.
/**
 * `attachmentCounts` — the inbox badge query.
 *
 * One helper, because the ~10-line count block (including the empty-list dodge) was
 * copy-pasted into both inbox pages and would drift the first time one was edited.
 */
import { describe, expect, it, vi } from 'vitest'
import { attachmentCounts } from '@/lib/enquiry-inbox-server'

const client = (rows: { enquiry_id: string }[]) => {
  const from = vi.fn(() => ({ select: () => ({ in: async () => ({ data: rows }) }) }))
  return { supabase: { from } as never, from }
}

describe('attachmentCounts', () => {
  it('counts attachments per enquiry; enquiries with none are simply absent', async () => {
    const { supabase } = client([
      { enquiry_id: 'e1' },
      { enquiry_id: 'e1' },
      { enquiry_id: 'e2' },
    ])
    const counts = await attachmentCounts(supabase, ['e1', 'e2', 'e3'])
    expect(counts.get('e1')).toBe(2)
    expect(counts.get('e2')).toBe(1)
    expect(counts.get('e3')).toBeUndefined()
  })

  it('CRITICAL: no enquiries → no query — an empty .in() list is a malformed filter, not "no rows"', async () => {
    const { supabase, from } = client([])
    expect(await attachmentCounts(supabase, [])).toEqual(new Map())
    expect(from).not.toHaveBeenCalled()
  })

  it('tolerates a null data payload', async () => {
    const from = vi.fn(() => ({ select: () => ({ in: async () => ({ data: null }) }) }))
    expect(await attachmentCounts({ from } as never, ['e1'])).toEqual(new Map())
  })
})
