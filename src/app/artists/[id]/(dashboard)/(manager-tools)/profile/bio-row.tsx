'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ABOUT_PLACEMENTS, type AboutPlacement } from '@samfox1/site-bridge/seo'
import { cx } from '@/lib/cx'
import { SAVE_FAILED } from '@/lib/manager-tools/format'
import { PLACEMENT } from '@/lib/manager-tools/profile/profile'
import { BIO_ANCHOR } from '@/lib/manager-tools/profile/route'
import { seoTabSeg } from '@/lib/manager-tools/seo/sections'
import { Icon } from '@/components/ui/icons'
import { isTooLong, TEXT_LIMITS } from '@/lib/site-editor/text-limits'
import { useDebouncedFieldSave } from '../../editor/use-debounced-field-save'
import { TextLimitHint } from '../../editor/inspector-shared'
import { saveEditorFieldAction, saveSeoFieldAction } from '../../actions'
import { CardModal } from '../../card-modal'
import { KvRow } from '../../modal-kit'
import { LedgerRow } from '../_ui/ledger'
import { RowIcon } from '../_ui/row-icon'
import { FOCUS_RING_OFFSET, MONO_META } from '../_ui/styles'
import { AreaField, EndSlot, LineField } from '../_ui/fields'
import { FieldError } from '../_ui/field-error'
import { clearHash, useOpenOnHash } from '../_ui/hash'
import { ChoiceMenu } from './choice-menu'

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
  about,
  nudge = '',
}: {
  artistId: string
  bio: string
  minWords: number
  about: { placement: string; heading: string }
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
      {open ? <BioModal artistId={artistId} bio={bio} minWords={minWords} about={about} onChange={setBio} onClose={close} /> : null}
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
 * The bio editor: the one bio (artists.bio, through the editor's own gate), its length, and
 * where it shows. Placement offers only what can take effect here: `hidden` always, the rest
 * only when the connected site declares them, and this page has no declaration (the Site
 * panel in the editor does) — the old About section's rule, kept.
 *
 * "Where it shows" and "Heading" are how the SITE shows the bio, so they belong in the site
 * editor (PROFILE_TOOL_PLAN.md); until that move they stay here, where Facts had them.
 */
function BioModal({
  artistId,
  bio,
  minWords,
  about,
  onChange,
  onClose,
}: {
  artistId: string
  bio: string
  minWords: number
  about: { placement: string; heading: string }
  onChange: (b: string) => void
  onClose: () => void
}) {
  const [placement, setPlacement] = useState(about.placement)
  const [heading, setHeading] = useState(about.heading)
  const bioSave = useDebouncedFieldSave<string>({
    persist: (_k, val) => saveEditorFieldAction(artistId, 'artist_bio', val, { store: 'artist', column: 'bio' }).then((r) => ({ ok: r.ok, error: r.error })),
    // Refused here too, before it is queued or sent: the server refuses it anyway, but this
    // box says why (TextLimitHint) and never spends a round trip finding out.
    normalize: (val) => (isTooLong(val, TEXT_LIMITS.bio) ? null : val),
  })
  const seoSave = useDebouncedFieldSave<string>({ persist: (k, val) => saveSeoFieldAction(artistId, k, val).then((r) => ({ ok: r.ok, error: r.error })) })
  const n = bio.trim().length
  const words = bio.trim() ? bio.trim().split(/\s+/).length : 0
  // A stored choice the editor made (with the site's declaration in hand) is kept on offer.
  const placements: AboutPlacement[] = ABOUT_PLACEMENTS.filter((x) => x === 'hidden' || x === about.placement)
  return (
    <CardModal open onClose={onClose} label="Bio">
      <div className="mt-2">
        <AreaField
          label="Bio"
          value={bio}
          rows={8}
          placeholder="Who you are, your sound, your big shows and releases."
          onChange={(v) => {
            onChange(v)
            bioSave.save('artist_bio', v)
          }}
          className="max-h-[50vh] min-h-[180px] w-full overflow-auto"
        />
        {/* The counts, while the bio is being written (Sam, 2026-09-29). They sat in the
            header's meta line until modal headers went (2026-10-02): a hint under the box. */}
        <div data-bio-counts="" className={cx('mt-2', MONO_META)}>
          {`${words} of ${minWords} words · ${n.toLocaleString('en-US')} characters`}
        </div>
        <TextLimitHint value={bio} max={TEXT_LIMITS.bio} />
        {bioSave.status === 'error' ? <FieldError>Couldn’t save the bio.</FieldError> : null}
      </div>
      <div className="mt-4">
        <KvRow label="Where it shows">
          <ChoiceMenu
            label="Where it shows"
            value={placement}
            options={[{ value: '', label: 'Site default' }, ...placements.map((x) => ({ value: x, label: PLACEMENT[x] }))]}
            align="start"
            onChange={(v) => {
              setPlacement(v)
              seoSave.save('about_placement', v)
            }}
          />
        </KvRow>
        <KvRow label="Heading">
          <LineField
            label="Heading"
            value={heading}
            placeholder="About"
            onChange={(v) => {
              setHeading(v)
              seoSave.save('about_heading', v)
            }}
            className="w-full"
          />
        </KvRow>
        {seoSave.status === 'error' ? <FieldError>{SAVE_FAILED}</FieldError> : null}
      </div>
    </CardModal>
  )
}
