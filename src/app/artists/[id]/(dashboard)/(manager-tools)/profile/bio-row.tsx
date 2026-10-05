'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { cx } from '@/lib/cx'
import { BIO_ANCHOR } from '@/lib/manager-tools/profile/route'
import { seoTabSeg } from '@/lib/manager-tools/seo/sections'
import { Icon } from '@/components/ui/icons'
import { formatCount, isTooLong, nearLimit, TEXT_LIMITS, tooLongError } from '@/lib/site-editor/text-limits'
import { useDebouncedFieldSave } from '../../editor/use-debounced-field-save'
import { saveEditorFieldAction } from '../../actions'
import { CardModal } from '../../card-modal'
import { LedgerRow } from '../_ui/ledger'
import { RowIcon } from '../_ui/row-icon'
import { FOCUS_RING_OFFSET } from '../_ui/styles'
import { EndSlot } from '../_ui/fields'
import { FieldError } from '../_ui/field-error'
import { clearHash, useOpenOnHash } from '../_ui/hash'

/**
 * The bio (`#bio`): a calm row, its first words and the pencil; the counts live in the editor,
 * shown while it is being written (Sam, 2026-09-29: no bar, no count at rest). Moved from the
 * SEO / GEO Facts tab to Profile (2026-10-02).
 *
 * `nudge`: "N outside bios may be out of date" (lib/manager-tools/profile/profile.ts
 * outsideBiosNudge), shown under the row's guide after a Publish changed a fact an outside bio
 * repeats; it leads to SEO / GEO › Profiles, where those bios are listed. '' says nothing.
 */
export function BioRow({
  artistId,
  bio: initialBio,
  minWords,
  nudge = '',
}: {
  artistId: string
  bio: string
  minWords: number
  nudge?: string
}) {
  const [bio, setBio] = useState(initialBio)
  const [open, setOpen] = useState(false)
  useOpenOnHash(BIO_ANCHOR, () => setOpen(true))
  const close = () => {
    setOpen(false)
    clearHash(BIO_ANCHOR)
  }
  const first = bio.trim().split(/\n+/)[0]?.trim() ?? ''
  // The id sits on an empty anchor beside the row, not on a wrapper around it: wrapped, the row
  // was its wrapper's last child and lost the hairline to the row under it (review L10).
  return (
    <>
      <span id={BIO_ANCHOR} aria-hidden="true" className="block scroll-mt-28" />
      <LedgerRow title="Bio" guide="Site, press kit, Google and AI answers." meta={nudge ? <Nudge artistId={artistId} text={nudge} /> : undefined}>
        <span data-bio-preview="" className={cx('min-w-0 max-w-[46ch] truncate text-[14px]', first ? 'text-ink-muted' : 'text-ink-faint')}>
          {first || 'No bio yet'}
        </span>
        <EndSlot>
          <RowIcon icon="edit" label="Edit the bio" onClick={() => setOpen(true)} />
        </EndSlot>
      </LedgerRow>
      {open ? <BioModal artistId={artistId} bio={bio} minWords={minWords} onChange={setBio} onClose={close} /> : null}
    </>
  )
}

/** The nudge line (prototypes/profile_tool_20261001.html, "Published"): a pending dot, the count
 *  in Space Mono, a chevron that steps right on hover. */
function Nudge({ artistId, text }: { artistId: string; text: string }) {
  return (
    <Link
      href={`/artists/${artistId}/${seoTabSeg('profiles')}`}
      data-bio-nudge=""
      className={cx('group/nudge mt-0.5 inline-flex items-center gap-[7px] rounded-md text-ink-muted transition-colors hover:text-ink', FOCUS_RING_OFFSET)}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 flex-none rounded-full bg-status-pending" />
      {text}
      <Icon name="chevronRight" size={12} className="text-ink-faint transition-transform duration-200 group-hover/nudge:translate-x-[2px] group-hover/nudge:text-ink" />
    </Link>
  )
}

/**
 * The bio window: only the writing (Sam, 2026-10-05, prototypes/bio_window_20261005.html, A
 * "Just the writing"). A reading measure (~64ch at 16px, 1.7 leading, so a blank line reads as
 * the paragraph gap), a hairline under the text that turns ink while writing, and the caret at
 * the end on open. Under it one faint count: "55 / 100 words" below the AI test's floor
 * (BIO_MIN_WORDS), "104 words" in ink once met, characters only near the cap.
 *
 * No Save and no footer: the bio autosaves to the draft (closing is done, the rising Publish
 * bar takes it live). "Where it shows" and "Heading" are how the SITE shows the bio, so they
 * live in the editor: Site › About (the site's real places) and Site › Heading beside it.
 */
function BioModal({
  artistId,
  bio,
  minWords,
  onChange,
  onClose,
}: {
  artistId: string
  bio: string
  minWords: number
  onChange: (b: string) => void
  onClose: () => void
}) {
  const box = useRef<HTMLTextAreaElement>(null)
  // The writing IS the window: open with the caret after the last word.
  useEffect(() => {
    const el = box.current
    if (!el) return
    el.focus({ preventScroll: true })
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])
  const bioSave = useDebouncedFieldSave<string>({
    persist: (_k, val) => saveEditorFieldAction(artistId, 'artist_bio', val, { store: 'artist', column: 'bio' }).then((r) => ({ ok: r.ok, error: r.error })),
    // Refused here too, before it is queued or sent: the server refuses it anyway, but this
    // window says why (the refusal under the count) and never spends a round trip finding out.
    normalize: (val) => (isTooLong(val, TEXT_LIMITS.bio) ? null : val),
  })
  const max = TEXT_LIMITS.bio
  const n = bio.trim().length
  const words = bio.trim() ? bio.trim().split(/\s+/).length : 0
  const met = words >= minWords
  const tooLong = isTooLong(bio, max)
  return (
    <CardModal open onClose={onClose} label="Bio" footer={null}>
      <div className="px-3 pb-0.5">
        {/* A click on the hairline's padding still lands in the text, as the mock's does. */}
        <div
          onMouseDown={(e) => {
            if (e.target === box.current) return
            e.preventDefault()
            box.current?.focus()
          }}
          className="cursor-text border-b border-hairline pb-4 transition-colors focus-within:border-ink"
        >
          <textarea
            ref={box}
            aria-label="Bio"
            value={bio}
            rows={8}
            spellCheck={false}
            placeholder="Who you are, your sound, your big shows and releases."
            onChange={(e) => {
              onChange(e.target.value)
              bioSave.save('artist_bio', e.target.value)
            }}
            className="block max-h-[56vh] min-h-[220px] w-full max-w-[64ch] resize-none overflow-auto border-0 bg-transparent p-0 text-[16px] leading-[1.7] text-ink caret-ink outline-none [field-sizing:content] placeholder:text-ink-faint"
          />
        </div>
        <div className="mt-2.5 flex min-h-4 items-baseline justify-between gap-4">
          {bioSave.status === 'error' ? <FieldError>Couldn’t save the bio.</FieldError> : null}
          <span
            data-bio-counts=""
            data-met={met ? '' : undefined}
            className={cx('ml-auto whitespace-nowrap font-space text-[11px] transition-colors duration-200 motion-reduce:transition-none', met ? 'text-ink' : 'text-ink-faint')}
          >
            {met ? `${words} words` : `${words} / ${minWords} words`}
            {nearLimit(bio, max) ? (
              <>
                {' · '}
                <span className={tooLong ? 'text-accent-red' : undefined}>{`${formatCount(n)} / ${formatCount(max)}`}</span>
              </>
            ) : null}
          </span>
        </div>
        {tooLong ? <FieldError>{tooLongError(max)}</FieldError> : null}
      </div>
    </CardModal>
  )
}
