'use client'
/* eslint-disable @next/next/no-img-element -- runtime Storage URLs; next/image would add a second resize. */

import { useEffect, useRef, useState } from 'react'
import { MAX_DESCRIPTION, MAX_TITLE } from '@samfox1/site-bridge/seo'
import { recommendAlt } from '@samfox1/site-bridge/alt'
import { cx } from '@/lib/cx'
import { SAVE_FAILED, plural } from '@/lib/manager-tools/format'
import { Icon } from '@/components/ui/icons'
import { useDebouncedFieldSave } from '../../../../editor/use-debounced-field-save'
import { saveSeoFieldAction, setMediaAltAction } from '../../../../actions'
import { CardModal } from '../../../../card-modal'
import { LedgerRow, LedgerSection } from '../../../_ui/ledger'
import { RowIcon } from '../../../_ui/row-icon'
import { FOCUS_RING_OFFSET, MONO_META } from '../../../_ui/styles'
import { ShareImageModal, type OgSource } from '../og-image-picker'
import type { NamedSwatch } from '../../../../editor/color-picker'
import { AreaField, Count, EndSlot, LineField } from '../../../_ui/fields'
import { FieldError } from '../../../_ui/field-error'
import { clearHash, useOpenOnHash } from '../../../_ui/hash'

export type AltPhoto = { id: string; url: string; alt: string; slug: string; caption: string | null }

/** The description's ONE limit: what Google shows (the bridge's MAX_DESCRIPTION). The save gate
 *  would take up to 300, but a red count at 160 and a refusal only at 300 were two limits for
 *  one box (the UI review, N21). */
export const DESCRIPTION_CAP = MAX_DESCRIPTION

/**
 * DETAILS, the tool's first tab (round 2, prototypes/seo_variants_20260928_r2.html; the Listing
 * tab until 2026-09-29): how the artist shows up when found or shared. Google (the page title,
 * the description, the result as Google draws it), Share (the picture a shared link shows,
 * `#share`) and Photos (the alt text, `#alt`). A test's pencil lands on those ids and opens
 * their editor.
 *
 * Rows AUTOSAVE to the draft, silently (the save model); a refusal shows under its row in the
 * gate's own words and is never sent. The layout's Publish bar ships them.
 */
export function DetailsTab({
  artistId,
  artistName,
  defaultTitle,
  bio,
  siteUrl,
  initial,
  shareUrl,
  sources,
  photos,
  brandColors,
}: {
  artistId: string
  artistName: string
  /** The title the site composes when this one is blank (the bridge's defaultSeoTitle). */
  defaultTitle: string
  bio: string
  siteUrl: string | null
  initial: { seo_title: string; seo_description: string }
  shareUrl: string
  sources: OgSource[]
  photos: AltPhoto[]
  /** The artist's Brand colours, by name: the picture's background swatches. */
  brandColors: readonly NamedSwatch[]
}) {
  const [v, setV] = useState(initial)
  const [errors, setErrors] = useState<Record<string, string | null>>({})
  /** The field being written: its count shows only then (Sam, 2026-09-29). */
  const [editing, setEditing] = useState<'seo_title' | 'seo_description' | null>(null)
  const done = () => setEditing(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const descRef = useRef<HTMLTextAreaElement>(null)
  const refuse = (k: string, msg: string | null) => setErrors((e) => ({ ...e, [k]: msg }))
  const save = useDebouncedFieldSave<string>({
    persist: async (k, val) => {
      const r = await saveSeoFieldAction(artistId, k, val)
      refuse(k, r.ok ? null : (r.error ?? SAVE_FAILED))
      return { ok: r.ok, error: r.error }
    },
    // Refused HERE, before it is queued or sent, in the gate's own words (never cut).
    normalize: (val, k) => {
      const cap = k === 'seo_title' ? MAX_TITLE : DESCRIPTION_CAP
      const tooLong = val.replace(/\s+/g, ' ').trim().length > cap
      // "Not saved": leaving the tab would otherwise lose it without a word (review N22).
      refuse(k, tooLong ? `Keep it under ${cap} characters. Not saved.` : null)
      return tooLong ? null : val
    },
  })
  const set = (k: 'seo_title' | 'seo_description', val: string) => {
    setV((s) => ({ ...s, [k]: val }))
    save.save(k, val)
  }

  const fallbackTitle = defaultTitle || artistName
  const title = v.seo_title.trim() || fallbackTitle
  const bioLine = bio.replace(/\s+/g, ' ').trim()
  const desc = v.seo_description.trim() || bioLine.slice(0, MAX_DESCRIPTION)

  return (
    <div>
      <LedgerSection label="Google">
        <LedgerRow title="Page title">
          <div className="flex w-[380px] min-w-0 max-w-full flex-col items-end gap-1">
            <LineField
              ref={titleRef}
              label="Page title"
              value={v.seo_title}
              placeholder={fallbackTitle}
              invalid={!!errors.seo_title}
              onChange={(val) => set('seo_title', val)}
              onFocus={() => setEditing('seo_title')}
              onBlur={done}
              className="w-full text-ellipsis text-left min-[900px]:text-right"
            />
            {errors.seo_title ? <FieldError>{errors.seo_title}</FieldError> : null}
          </div>
          {editing === 'seo_title' ? <Count n={title.length} max={MAX_TITLE} /> : null}
          <EndSlot>
            <RowIcon icon="edit" label="Edit the page title" onClick={() => titleRef.current?.focus()} />
          </EndSlot>
        </LedgerRow>
        <LedgerRow title="Description">
          <div className="flex min-w-0 flex-1 flex-col items-end gap-1">
            <AreaField
              ref={descRef}
              label="Description"
              value={v.seo_description}
              placeholder={bioLine.slice(0, MAX_DESCRIPTION) || 'What you do, in a line or two'}
              onChange={(val) => set('seo_description', val)}
              onFocus={() => setEditing('seo_description')}
              onBlur={done}
              tone="muted"
              small
              className="w-full max-w-[52ch] text-left min-[900px]:text-right"
            />
            {errors.seo_description ? <FieldError>{errors.seo_description}</FieldError> : null}
          </div>
          {editing === 'seo_description' ? <Count n={desc.length} max={MAX_DESCRIPTION} /> : null}
          <EndSlot>
            <RowIcon icon="edit" label="Edit the description" onClick={() => descRef.current?.focus()} />
          </EndSlot>
        </LedgerRow>
        <LedgerRow title="Preview">
          <div className="w-full max-w-[520px] rounded-lg bg-surface px-4 py-3 text-left" data-testid="google-preview">
            <div className={cx('truncate', MONO_META)}>{siteUrl ?? 'your site'}</div>
            <div className="mt-0.5 truncate text-[16px] text-accent">{title}</div>
            <div className="mt-0.5 line-clamp-2 text-[12px] leading-[1.35] text-ink-muted">{desc || '—'}</div>
          </div>
          <EndSlot />
        </LedgerRow>
      </LedgerSection>

      <LedgerSection label="Share">
        <ShareRow artistId={artistId} currentUrl={shareUrl} sources={sources} brandColors={brandColors} />
      </LedgerSection>

      <LedgerSection label="Photos">
        <AltRow artistId={artistId} artistName={artistName} photos={photos} />
      </LedgerSection>
    </div>
  )
}

/** The preview picture (`#share`, Sam's name for the share image, 2026-09-29): the card a
 *  shared link shows; its editor is the picture window. */
function ShareRow({ artistId, currentUrl, sources, brandColors }: { artistId: string; currentUrl: string; sources: OgSource[]; brandColors: readonly NamedSwatch[] }) {
  const [url, setUrl] = useState(currentUrl)
  const [open, setOpen] = useState(false)
  useOpenOnHash('share', () => setOpen(true))
  const close = () => {
    setOpen(false)
    clearHash('share')
  }
  return (
    <div id="share" className="scroll-mt-28">
      <LedgerRow title="Preview picture">
        <button
          type="button"
          aria-label={url ? 'Open the preview picture' : 'Make a preview picture'}
          onClick={() => setOpen(true)}
          className={cx(
            'h-[92px] w-[176px] flex-none overflow-hidden rounded-lg border border-hairline bg-paper',
            url ? 'block' : 'flex items-center justify-center border-dashed text-ink-faint hover:text-accent',
            FOCUS_RING_OFFSET,
          )}
        >
          {url ? <img src={url} alt="" className="block h-full w-full object-cover" /> : <Icon name="plus" size={18} />}
        </button>
        <EndSlot>
          <RowIcon icon="edit" label="Change the preview picture" onClick={() => setOpen(true)} />
        </EndSlot>
      </LedgerRow>
      {open ? <ShareImageModal artistId={artistId} sources={sources} brandColors={brandColors} onClose={close} onSaved={setUrl} /> : null}
    </div>
  )
}

/** Alt text (`#alt`): the site's photos and the words Google Images reads for each. */
function AltRow({ artistId, artistName, photos: initial }: { artistId: string; artistName: string; photos: AltPhoto[] }) {
  const [photos, setPhotos] = useState(initial)
  const [open, setOpen] = useState(false)
  useOpenOnHash('alt', () => setOpen(true))
  const close = () => {
    setOpen(false)
    clearHash('alt')
  }
  const meta = photos.length ? plural(photos.length, 'photo', 'photos') : undefined
  return (
    <div id="alt" className="scroll-mt-28">
      <LedgerRow title="Photo descriptions" meta={meta}>
        {photos.length ? (
          <button type="button" aria-label="Open the photos" onClick={() => setOpen(true)} className={cx('flex gap-1.5 rounded-md', FOCUS_RING_OFFSET)}>
            {photos.slice(0, 6).map((p) => (
              <img key={p.id} src={p.url} alt="" className="block h-9 w-9 rounded-md border border-hairline object-cover" />
            ))}
          </button>
        ) : (
          <span className="font-space text-[12px] text-ink-faint">No photos on the site yet</span>
        )}
        <EndSlot>{photos.length ? <RowIcon icon="edit" label="Edit the photo descriptions" onClick={() => setOpen(true)} /> : null}</EndSlot>
      </LedgerRow>
      {open && photos.length ? <AltModal artistId={artistId} artistName={artistName} photos={photos} onChange={setPhotos} onClose={close} /> : null}
    </div>
  )
}

/**
 * THE PHOTO DESCRIPTIONS, one photo at a time (Sam, 2026-09-29: "arrows to move between
 * photos so one is showing at a time"): the picture large enough to describe, its description
 * under it (blank = the one made for you, shown faint as the hint), ← → to move (the arrow
 * keys too, when not typing) and a quiet "3 of 6". Each photo's words save as they are typed.
 * No file names here: they are codes a manager can't read (the UI review, L8).
 */
function AltModal({ artistId, artistName, photos, onChange, onClose }: { artistId: string; artistName: string; photos: AltPhoto[]; onChange: (p: AltPhoto[]) => void; onClose: () => void }) {
  const [at, setAt] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const altSave = useDebouncedFieldSave<string>({
    persist: async (id, val) => {
      const r = await setMediaAltAction(artistId, id, val)
      setError(r.error ?? null)
      return { ok: !r.error, error: r.error }
    },
  })
  const setAlt = (id: string, alt: string) => {
    onChange(photos.map((p) => (p.id === id ? { ...p, alt } : p)))
    altSave.save(id, alt)
  }
  const i = Math.min(at, photos.length - 1)
  const p = photos[i]
  const go = (d: -1 | 1) => setAt((n) => Math.max(0, Math.min(photos.length - 1, n + d)))
  // ← → move between photos, except while typing (they move the cursor there).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      const t = e.target as HTMLElement | null
      if (t?.closest('input, textarea, [contenteditable="true"]')) return
      e.preventDefault()
      setAt((n) => Math.max(0, Math.min(photos.length - 1, n + (e.key === 'ArrowRight' ? 1 : -1))))
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [photos.length])
  if (!p) return null
  const preset = recommendAlt({ artist: artistName, caption: p.caption })
  return (
    // No footer: each photo's words save as they are typed, and ✕ closes (the modal kit's rule).
    // No title either (Sam, 2026-10-02): the pencil that opened it already said what it is.
    <CardModal open onClose={onClose} label="Photo descriptions" footer={null}>
      <div className="mt-2 flex flex-col gap-3">
        <div className="flex h-[340px] items-center justify-center overflow-hidden rounded-xl bg-surface">
          <img key={p.id} src={p.url} alt="" className="max-h-full max-w-full object-contain" />
        </div>
        <AreaField key={p.id} label={`Description of photo ${i + 1}`} value={p.alt} placeholder={preset} rows={2} small onChange={(val) => setAlt(p.id, val)} className="w-full" />
        {error ? <FieldError>{error}</FieldError> : null}
        <div className="flex items-center justify-center gap-3">
          <RowIcon icon="chevronLeft" label="Previous photo" variant="primary" onClick={() => go(-1)} disabled={i === 0} />
          <span className="min-w-[56px] text-center font-space text-[12px] text-ink-faint" aria-live="polite">{`${i + 1} of ${photos.length}`}</span>
          <RowIcon icon="chevronRight" label="Next photo" variant="primary" onClick={() => go(1)} disabled={i === photos.length - 1} />
        </div>
      </div>
    </CardModal>
  )
}
