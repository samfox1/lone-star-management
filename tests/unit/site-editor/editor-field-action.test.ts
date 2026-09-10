// Which save path a text edit takes: a built-in template, or the artist's own site.
/**
 * saveEditorFieldAction — which WRITE PATH an artist's row selects.
 *
 * The action is the only place that knows whether the site being edited is a built-in
 * template or the artist's own custom site, and `saveEditorField` cannot work it out
 * afterwards: `artists_template_check` allows only 'classic'/'cinematic', so a custom
 * artist (skeen is 'cinematic' + site_kind='custom') still resolves a perfectly good
 * built-in manifest. The shipped bug was exactly that — every save of one of skeen's own
 * fields came back 'Unknown field.' because it was checked against cinematic's field list.
 *
 * So the assertion is on the ARGUMENT handed down: null for a custom site, the template
 * for a built-in one. Asserting the returned {ok} instead would pass on either path.
 * No DB: the row is mocked, because what is under test is the branch, not the write.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { saveEditorField } from '@/lib/site-editor/save'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

/** The artists row the action reads. Swapped per test. */
let artistRow: Record<string, unknown> | null = {
  template: 'cinematic',
  site_kind: 'template',
  custom_site_url: null,
}
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: artistRow }) }) }),
    }),
  })),
}))
vi.mock('@/lib/site-editor/save', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/site-editor/save')>()),
  saveEditorField: vi.fn(async () => ({ ok: true })),
}))

const write = vi.mocked(saveEditorField)

/** The template argument the action handed to the write. */
const templateArg = () => write.mock.calls[0]![2]

beforeEach(() => {
  write.mockClear()
})

describe('saveEditorFieldAction — template vs custom site', () => {
  it('CRITICAL: a CUSTOM site is saved with template null (its fields are not in any local manifest)', async () => {
    artistRow = { template: 'cinematic', site_kind: 'custom', custom_site_url: 'https://skeen.example' }
    const { saveEditorFieldAction } = await import('@/app/artists/[id]/(dashboard)/actions')
    await saveEditorFieldAction('a1', 'hero_caption', '/ backstage /')
    expect(templateArg()).toBeNull()
  })

  it('a BUILT-IN template is saved against its own manifest', async () => {
    artistRow = { template: 'cinematic', site_kind: 'template', custom_site_url: null }
    const { saveEditorFieldAction } = await import('@/app/artists/[id]/(dashboard)/actions')
    await saveEditorFieldAction('a1', 'hero_tagline', 'DJ')
    expect(templateArg()).toBe('cinematic')
  })

  it('a custom_site_url that is not a usable site stays on the TEMPLATE path', async () => {
    // Same rule the public redirect applies (isCustom → redirectTarget): a half-configured
    // row must not silently turn the editor into an unvalidated site_content writer.
    artistRow = { template: 'classic', site_kind: 'custom', custom_site_url: 'not-a-url' }
    const { saveEditorFieldAction } = await import('@/app/artists/[id]/(dashboard)/actions')
    await saveEditorFieldAction('a1', 'tracks_heading', 'Songs')
    expect(templateArg()).toBe('classic')
  })

  it('a missing artist never reaches the write', async () => {
    artistRow = null
    const { saveEditorFieldAction } = await import('@/app/artists/[id]/(dashboard)/actions')
    expect(await saveEditorFieldAction('a1', 'hero_caption', 'x')).toEqual({
      ok: false,
      error: 'Artist not found.',
    })
    expect(write).not.toHaveBeenCalled()
  })
})
