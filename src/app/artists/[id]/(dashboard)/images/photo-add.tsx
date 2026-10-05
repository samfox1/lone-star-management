'use client'

import { useEffect, useState } from 'react'
import { modalCardClass, modalOverlayClass } from '@/components/ui/ui'
import { MediaUploader } from '../media-uploader'
import { AddTrigger } from '../create-modal'
import { useLockBodyScroll } from '@/components/ui/use-lock-body-scroll'

/**
 * The Photos page's "+ Add" — same collapsed-label toolbar trigger as the other
 * add buttons, opening a small modal with the image drop field (direct-to-
 * Storage upload, registered as a gallery_image).
 */
export function PhotoAddButton({ artistId }: { artistId: string }) {
  const [open, setOpen] = useState(false)
  useLockBodyScroll(open)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <AddTrigger label="Add photo" onClick={() => setOpen(true)} />

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Add photos"
          className={modalOverlayClass}
          onClick={(e) => e.target === e.currentTarget && setOpen(false)}
        >
          {/* Narrow, matching the Music/Video add modals (just a drop field here). */}
          <div className={`${modalCardClass} font-space !w-[440px]`}>
            {/* No title (Sam, 2026-10-02): the Add button already said what this is. */}
            <div>
              <MediaUploader artistId={artistId} purpose="gallery_image" folder="gallery" accept="image/*" label="Drop images or click to upload" />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
