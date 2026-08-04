/**
 * `savePressDocumentAction`'s guards.
 *
 * `kind` selects which artists COLUMN gets written, and it arrives from the client. Without
 * the allowlist this action is a general-purpose column writer on `artists` — the table
 * holding the template, the integration ids and the site config.
 *
 * A mutation sweep found this untested: deleting the allowlist failed nothing, because the
 * DB tests call the pure `setPressDocument` underneath and the page tests mock the module
 * away. Same shape of gap the Brand actions had.
 *
 * The second assertion in each case is the load-bearing one: checking only the return value
 * would still pass if a refactor moved validation AFTER the write.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { setPressDocument } from '@/lib/epk'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

let visible = true
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: visible ? { id: 'a1' } : null }) }),
      }),
    }),
  })),
}))
vi.mock('@/lib/epk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/epk')>()),
  setPressDocument: vi.fn(async () => ({ ok: true })),
}))

const mockedWrite = vi.mocked(setPressDocument)
const load = () => import('@/app/artists/[id]/(dashboard)/epk/actions')

beforeEach(() => {
  mockedWrite.mockClear()
  visible = true
})

describe('savePressDocumentAction — kind allowlist', () => {
  it('accepts the two document kinds', async () => {
    const { savePressDocumentAction } = await load()
    for (const ok of ['tech_rider', 'stage_plot']) {
      expect((await savePressDocumentAction('a1', ok, null)).error).toBeUndefined()
    }
    expect(mockedWrite).toHaveBeenCalledTimes(2)
  })

  it('CRITICAL: refuses any other column name, and never reaches the write', async () => {
    const { savePressDocumentAction } = await load()
    // `template` and `site_kind` are real artists columns — this is the reason the
    // allowlist exists, not a hypothetical.
    for (const bad of ['template', 'site_kind', 'slug', 'press_pitch', '', 'tech_rider ']) {
      expect((await savePressDocumentAction('a1', bad, null)).error).toBe('Unknown document.')
    }
    expect(mockedWrite).not.toHaveBeenCalled()
  })

  it('CRITICAL: a blocked write reports failure rather than silent success', async () => {
    const { savePressDocumentAction } = await load()
    visible = false
    expect((await savePressDocumentAction('a1', 'tech_rider', null)).error).toBe('Not found.')
    expect(mockedWrite).not.toHaveBeenCalled()
  })
})
