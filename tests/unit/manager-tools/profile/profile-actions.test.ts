/**
 * The Profile page's own two actions keep their guards on the server: the photo is set only for
 * the artist's owner, and the name only when its rule passes, trimmed.
 *
 * Code:     src/app/artists/[id]/(dashboard)/(manager-tools)/profile/photo-actions.ts
 *           (setProfilePhotoAction), profile/actions.ts (saveArtistNameAction)
 * Feature:  Profile (PROFILE_TOOL_PLAN.md): the photo row's picker and every upload door, and the
 *           Name row
 * Tier:     STRICT (AGENTS.md "Test depth"): an ownership gate and a validator on the server. Every
 *           component test mocks these modules away, so before this file deleting either guard
 *           turned nothing red.
 * Covers:   • the photo: an owner's call reaches setProfilePhotoFromImage once, with the ids; no
 *             user, or an artist RLS hides, never reaches it
 *           • the name: a blank or over-long one answers in artistNameError's own words and never
 *             opens a client; a good one is stored trimmed
 * Not here: the photo write itself (tests/unit/manager-tools/profile/profile-photo.test.ts); the
 *           name rule's cases (profile.test.ts); the rows that call these
 *           (tests/components/manager-tools/profile/).
 * Fixtures: a fake Supabase client (getUser, the ownership read, the name update) with toggles for
 *           no user and an artist RLS hides; setProfilePhotoFromImage is a mock. No database.
 *           Each guard was deleted once and its test went red (2026-10-05).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ARTIST_NAME_MAX, artistNameError } from '@/lib/manager-tools/profile/profile'
import { setProfilePhotoFromImage } from '@/lib/profile-photo'
import { createClient } from '@/lib/supabase/server'

const db = vi.hoisted(() => ({
  user: { id: 'u1' } as { id: string } | null,
  /** False: RLS hides the artist from this caller (not theirs). */
  visible: true,
  updates: [] as Record<string, unknown>[],
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: db.user } }) },
    from: () => ({
      // requireOwnedArtist's read.
      select: () => ({ eq: () => ({ single: async () => ({ data: db.visible ? { id: 'a1' } : null }) }) }),
      // saveArtistNameAction's write.
      update: (values: Record<string, unknown>) => {
        db.updates.push(values)
        return { eq: () => ({ select: () => ({ single: async () => ({ data: { id: 'a1' }, error: null }) }) }) }
      },
    }),
  })),
}))
vi.mock('@/lib/profile-photo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/profile-photo')>()),
  setProfilePhotoFromImage: vi.fn(async () => ({ ok: true })),
}))

const photoWrite = vi.mocked(setProfilePhotoFromImage)
const clientMade = vi.mocked(createClient)
const photoActions = () => import('@/app/artists/[id]/(dashboard)/(manager-tools)/profile/photo-actions')
const nameActions = () => import('@/app/artists/[id]/(dashboard)/(manager-tools)/profile/actions')

beforeEach(() => {
  vi.clearAllMocks()
  db.user = { id: 'u1' }
  db.visible = true
  db.updates = []
})

describe('setProfilePhotoAction: the owner gate', () => {
  // An owner's pick reaches the one photo write, once, with the artist and the Images row.
  it('an owner sets the photo through setProfilePhotoFromImage', async () => {
    const { setProfilePhotoAction } = await photoActions()
    expect(await setProfilePhotoAction('a1', 'm1')).toEqual({})
    expect(photoWrite).toHaveBeenCalledTimes(1)
    expect(photoWrite).toHaveBeenCalledWith(expect.anything(), 'a1', 'm1')
  })

  // No session, or an artist RLS hides: an error, and the write is never reached. Without the
  // gate a row-filtered write could answer "done" to someone it changed nothing for.
  it('CRITICAL: no user, or not the owner, never reaches the photo write', async () => {
    const { setProfilePhotoAction } = await photoActions()
    db.user = null
    expect(await setProfilePhotoAction('a1', 'm1')).toEqual({ error: 'Not signed in.' })
    db.user = { id: 'u1' }
    db.visible = false
    expect(await setProfilePhotoAction('a1', 'm1')).toEqual({ error: 'Artist not found.' })
    expect(photoWrite).not.toHaveBeenCalled()
  })
})

describe('saveArtistNameAction: the name rule on the server', () => {
  // A blank or too-long name answers in the rule's own words before any client is made: the
  // column has no CHECK, so this is the only thing between a direct call and a stored blank.
  it('CRITICAL: a blank or over-long name is refused in the rule’s words and never written', async () => {
    const { saveArtistNameAction } = await nameActions()
    for (const bad of ['   ', 'x'.repeat(ARTIST_NAME_MAX + 1)]) {
      expect(await saveArtistNameAction('a1', bad)).toEqual({ error: artistNameError(bad) })
    }
    expect(clientMade).not.toHaveBeenCalled()
    expect(db.updates).toEqual([])
  })

  // A good name is stored trimmed: the spaces a manager typed around it never reach the site.
  it('stores the name trimmed', async () => {
    const { saveArtistNameAction } = await nameActions()
    expect(await saveArtistNameAction('a1', '  Skeen ')).toEqual({})
    expect(db.updates).toEqual([{ name: 'Skeen' }])
  })
})
