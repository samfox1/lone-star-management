'use client'

import { useRef, useState } from 'react'
import { PortalModal } from '@/components/ui/portal-modal'
import { Icon } from '@/components/ui/icons'
import { EDIT_GLYPH } from '@/components/ui/icon-hover'
import { cx } from '@/lib/cx'
import { mediaThumbUrl } from '@/lib/storage-url'
import { MediaUploader } from '../../media-uploader'
import { toast } from '../../toast'
import { HoverLabel } from '../_ui/row-icon'
import { FOCUS_RING_OFFSET } from '../_ui/styles'
import { useSeeded } from '../_ui/use-seeded'
import { setProfilePhotoAction } from './photo-actions'

/** One of the artist's Images: its media id, file and a small preview. */
export type LibraryPhoto = { id: string; path: string; thumb: string }
/** The profile photo now: its file and a small preview. */
export type CurrentPhoto = { path: string; thumb: string }

/** The picker: big, no header (Sam, 2026-10-01: "the user knows whats going on here"). */
const PICKER_CARD =
  'relative flex max-h-[calc(100dvh-64px)] w-[min(1040px,calc(100vw-32px))] max-w-full flex-col overflow-auto rounded-2xl bg-paper p-7 font-ui shadow-2xl'

/** A picker tile: square, ~168px, the hover ring the mock draws. */
const PICK_TILE = cx(
  'relative aspect-square overflow-hidden rounded-[10px] border border-hairline bg-surface ring-ink ring-offset-2 ring-offset-paper transition-shadow hover:ring-[1.5px]',
  FOCUS_RING_OFFSET,
)

/**
 * THE PROFILE PHOTO CONTROL (prototypes/profile_tool_20261001.html, round 3): a 64px round tile.
 * Empty, the + sits inside the circle; set, the photo, with a pencil on hover. Either opens the
 * picker: the artist's Images as big thumbnails, then an upload tile. A pick makes that photo the
 * profile photo; an upload lands in Images (the same uploader, bucket and folder as the Images
 * page) and becomes the profile photo. Both are drafts until Publish, like every photo.
 *
 * The tile shows the pick at once and puts the old one back if the save is refused. `busy` is a
 * ref, not state: two fast picks both read the state before React re-renders.
 *
 * ONE SAVE AT A TIME, AND THE LATER ACTION WINS: a pick or an upload that arrives while another
 * is still saving waits in `queued` and runs next (a newer one replaces it). An upload that
 * finished mid-save used to land in Images and silently not become the profile photo.
 */
export function ProfilePhotoControl({ artistId, current, photos }: { artistId: string; current: CurrentPhoto | null; photos: LibraryPhoto[] }) {
  const [shown, setShown] = useSeeded(current)
  const [open, setOpen] = useState(false)
  const busy = useRef(false)
  const queued = useRef<LibraryPhoto | null>(null)

  /** `was`: what to put back if this save is refused. A queued save gets the photo the save
   *  before it left in place, not the stale render's. */
  async function pick(photo: LibraryPhoto, was: CurrentPhoto | null = shown) {
    if (busy.current) {
      queued.current = photo
      return
    }
    busy.current = true
    let now = was
    setShown({ path: photo.path, thumb: photo.thumb })
    setOpen(false)
    try {
      const res = await setProfilePhotoAction(artistId, photo.id)
      if (res.error) {
        setShown(was)
        toast(res.error, 'error')
      } else now = { path: photo.path, thumb: photo.thumb }
    } catch {
      setShown(was)
      toast('Could not set the profile photo.', 'error')
    } finally {
      busy.current = false
      const next = queued.current
      queued.current = null
      if (next) void pick(next, now)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={shown ? 'Change the profile photo' : 'Add a profile photo'}
        data-profile-photo={shown ? 'set' : 'empty'}
        className={cx(
          'group relative grid h-16 w-16 flex-none cursor-pointer place-items-center overflow-hidden rounded-full border border-hairline',
          shown ? 'bg-surface' : 'border-dashed text-ink transition-colors hover:border-accent hover:text-accent',
          FOCUS_RING_OFFSET,
        )}
      >
        {shown ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- a storage render URL, already sized */}
            <img src={shown.thumb} alt="" className="absolute inset-0 h-full w-full object-cover" />
            <span className="absolute inset-0 grid place-items-center bg-black/35 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
              <Icon name="edit" size={EDIT_GLYPH} />
            </span>
          </>
        ) : (
          <Icon name="plus" size={20} />
        )}
        <HoverLabel label={shown ? 'Change' : 'Add photo'} />
      </button>

      {open ? (
        <PortalModal ariaLabel="Images" onClose={() => setOpen(false)} cardClass={PICKER_CARD}>
          <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-3">
            {photos.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => void pick(p)}
                aria-label="Use this photo"
                aria-pressed={shown?.path === p.path}
                className={cx(PICK_TILE, shown?.path === p.path && 'ring-[1.5px]')}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- a storage render URL, already sized */}
                <img src={p.thumb} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
                <HoverLabel label="Use this photo" />
              </button>
            ))}
            <MediaUploader
              artistId={artistId}
              purpose="gallery_image"
              folder="gallery"
              accept="image/*"
              label="Upload a photo"
              onUploaded={(m) => void pick({ id: m.id, path: m.storage_path, thumb: mediaThumbUrl(m.storage_path, { size: 400 }) })}
              trigger={(choose, { busy: uploading }) => (
                <button
                  type="button"
                  onClick={choose}
                  disabled={uploading}
                  aria-label="Upload a photo"
                  className={cx(PICK_TILE, 'grid place-items-center border-dashed bg-transparent text-ink-faint hover:text-ink disabled:cursor-wait')}
                >
                  {uploading ? <span className="font-space text-[11px] text-ink-muted">Uploading…</span> : <Icon name="upload" size={20} />}
                  <HoverLabel label="Upload" />
                </button>
              )}
            />
          </div>
        </PortalModal>
      ) : null}
    </>
  )
}
