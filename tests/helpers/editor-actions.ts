/**
 * The dashboard's server actions, mocked ONCE for the editor's component suites.
 *
 * Three files carried their own copy of this list (editor-inspector, site-seo-editor,
 * editor-text-pages — the last as a Proxy that minted a fresh vi.fn on every property
 * read, so `vi.mocked(x)` in a test could never be the fn the component called). One
 * list, and a new action that the inspector starts importing is added here rather than
 * in whichever suite fails first. Use it as:
 *
 *   vi.mock('@/app/artists/[id]/(dashboard)/actions', () => import('./helpers/editor-actions'))
 *
 * A factory that returns this module's promise is what vitest's hoisting allows; the
 * mocked functions are then the SAME objects `vi.mocked(...)` hands back in the test.
 */
import { vi } from 'vitest'

const ok = () => vi.fn(async () => ({ ok: true }))
const bare = () => vi.fn(async () => ({}))

export const saveSeoFieldAction = ok()
export const saveArtistFactAction = ok()
export const saveCursorFieldAction = ok()
export const saveEditorFieldAction = bare()
export const saveEditorStyleAction = ok()
export const saveEditorLinkAction = ok()
export const deleteMediaAction = bare()
export const reorderGalleryAction = bare()
export const updateContentAction = bare()
export const deleteContentAction = bare()
export const reorderContentAction = bare()
export const renameVideoAction = bare()
export const setOnSiteAction = bare()
export const placeGalleryPhotoAction = bare()
export const setMediaLabelAction = bare()
export const setMediaAltAction = bare()
export const setMediaKindAction = bare()
export const renameMediaAction = vi.fn(async () => ({ storage_path: 'artist-1/gallery/renamed.jpg' }))
export const setSupportUrlAction = bare()
export const assignHeroSlotAction = bare()
export const assignComponentSlotAction = bare()
export const setSongsOnSiteAction = bare()
export const setImageFieldAction = ok()
export const addContentAction = bare()
export const restorePublishedAction = vi.fn(async () => ({ ok: true, changed: 3, hasPublished: true }))
export const listPublishMomentsAction = vi.fn(async () => ({
  ok: true,
  moments: [
    { publishedAt: '2026-08-14T18:00:00.000Z', entities: 4 },
    { publishedAt: '2026-08-10T09:30:00.000Z', entities: 12 },
  ],
}))
