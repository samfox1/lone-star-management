'use client'
/* eslint-disable @next/next/no-img-element -- runtime Storage URLs; next/image would add a second resize. */

import { useRef, useState } from 'react'
import { MAX_DESCRIPTION, MAX_TITLE } from '@samfox1/site-bridge/seo'
import { recommendAlt, recommendSlug } from '@samfox1/site-bridge/alt'
import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'
import { useDebouncedFieldSave } from '../../../../editor/use-debounced-field-save'
import { renameMediaAction, saveSeoFieldAction, setMediaAltAction } from '../../../../actions'
import { CardModal } from '../../../../card-modal'
import { MetaDot, ModalHeader } from '../../../../modal-kit'
import { LedgerRow, LedgerSection } from '../../../_ui/ledger'
import { RowIcon } from '../../../_ui/row-icon'
import { FOCUS_RING } from '../../../_ui/focus-ring'
import { ShareImageModal, type OgSource } from '../og-image-picker'
import { AreaField, Count, EndSlot, FieldError, LineField } from '../_ui/parts'
import { clearHash, useOpenOnHash } from '../_ui/hash'

export type AltPhoto = { id: string; url: string; alt: string; slug: string; caption: string | null }

/** The most `seo_description` may hold (the save gate's SEO_LIMITS; Google shows 160). */
export const DESCRIPTION_CAP = 300

/** The card this page draws is always 1200 × 630, at one fixed path per artist. */
const OUR_CARD = /\/storage\/v1\/object\/public\/media\/[^/]+\/og\/social-card\.png/

/**
 * LISTING (round 2, prototypes/seo_variants_20260928_r2.html): how the artist shows up when
 * found or shared. Google (the page title, the description, the result as Google draws it),
 * Share (the picture a shared link shows, `#share`) and Photos (the alt text, `#alt`). A test's
 * pencil lands on those ids and opens their editor.
 *
 * Rows AUTOSAVE to the draft, silently (the save model); a refusal shows under its row in the
 * gate's own words and is never sent. The layout's Publish bar ships them.
 */
export function ListingTab({
  artistId,
  artistName,
  defaultTitle,
  bio,
  siteUrl,
  initial,
  shareUrl,
  sources,
  photos,
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
}) {
  const [v, setV] = useState(initial)
  const [errors, setErrors] = useState<Record<string, string | null>>({})
  const titleRef = useRef<HTMLInputElement>(null)
  const descRef = useRef<HTMLTextAreaElement>(null)
  const refuse = (k: string, msg: string | null) => setErrors((e) => ({ ...e, [k]: msg }))
  const save = useDebouncedFieldSave<string>({
    persist: async (k, val) => {
      const r = await saveSeoFieldAction(artistId, k, val)
      refuse(k, r.ok ? null : (r.error ?? 'Couldn’t save that.'))
      return { ok: r.ok, error: r.error }
    },
    // Refused HERE, before it is queued or sent, in the gate's own words (never cut).
    normalize: (val, k) => {
      const cap = k === 'seo_title' ? MAX_TITLE : DESCRIPTION_CAP
      const tooLong = val.replace(/\s+/g, ' ').trim().length > cap
      refuse(k, tooLong ? `Keep it under ${cap} characters.` : null)
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
        <LedgerRow title="Page title" guide="Blank builds it from Facts.">
          <div className="flex w-[380px] min-w-0 max-w-full flex-col items-end gap-1">
            <LineField
              ref={titleRef}
              label="Page title"
              value={v.seo_title}
              placeholder={fallbackTitle}
              invalid={!!errors.seo_title}
              onChange={(val) => set('seo_title', val)}
              className="w-full text-right"
            />
            {errors.seo_title ? <FieldError>{errors.seo_title}</FieldError> : null}
          </div>
          <Count n={title.length} max={MAX_TITLE} />
          <EndSlot>
            <RowIcon icon="edit" label="Edit" onClick={() => titleRef.current?.focus()} />
          </EndSlot>
        </LedgerRow>
        <LedgerRow title="Description" guide="Blank uses the bio.">
          <div className="flex min-w-0 flex-1 flex-col items-end gap-1">
            <AreaField
              ref={descRef}
              label="Description"
              value={v.seo_description}
              placeholder={bioLine.slice(0, MAX_DESCRIPTION) || 'What you do, in a line or two'}
              onChange={(val) => set('seo_description', val)}
              tone="muted"
              small
              className="w-full max-w-[52ch] text-right"
            />
            {errors.seo_description ? <FieldError>{errors.seo_description}</FieldError> : null}
          </div>
          <Count n={desc.length} max={MAX_DESCRIPTION} />
          <EndSlot>
            <RowIcon icon="edit" label="Edit" onClick={() => descRef.current?.focus()} />
          </EndSlot>
        </LedgerRow>
        <LedgerRow title="Preview">
          <div className="w-full max-w-[520px] rounded-lg bg-surface px-4 py-3 text-left" data-testid="google-preview">
            <div className="truncate font-space text-[11px] text-ink-faint">{siteUrl ?? 'your site'}</div>
            <div className="mt-0.5 truncate text-[16px] text-accent">{title}</div>
            <div className="mt-0.5 line-clamp-2 text-[12px] leading-[1.35] text-ink-muted">{desc || '—'}</div>
          </div>
          <EndSlot />
        </LedgerRow>
      </LedgerSection>

      <LedgerSection label="Share">
        <ShareRow artistId={artistId} currentUrl={shareUrl} sources={sources} />
      </LedgerSection>

      <LedgerSection label="Photos">
        <AltRow artistId={artistId} artistName={artistName} photos={photos} />
      </LedgerSection>
    </div>
  )
}

/** Share image (`#share`): the card a shared link shows; its editor is the share modal. */
function ShareRow({ artistId, currentUrl, sources }: { artistId: string; currentUrl: string; sources: OgSource[] }) {
  const [url, setUrl] = useState(currentUrl)
  const [open, setOpen] = useState(false)
  useOpenOnHash('share', () => setOpen(true))
  const close = () => {
    setOpen(false)
    clearHash('share')
  }
  return (
    <div id="share" className="scroll-mt-28">
      <LedgerRow title="Share image" guide="iMessage, X, Instagram." meta={url && OUR_CARD.test(url) ? '1200 × 630' : undefined}>
        <button
          type="button"
          aria-label={url ? 'Open the share picture' : 'Add a share picture'}
          onClick={() => setOpen(true)}
          className={cx(
            'h-[92px] w-[176px] flex-none overflow-hidden rounded-lg border border-hairline bg-paper',
            url ? 'block' : 'flex items-center justify-center border-dashed text-ink-faint hover:text-accent',
            FOCUS_RING,
            'focus-visible:outline-offset-2',
          )}
        >
          {url ? <img src={url} alt="" className="block h-full w-full object-cover" /> : <Icon name="plus" size={18} />}
        </button>
        <EndSlot>
          <RowIcon icon="edit" label="Change" onClick={() => setOpen(true)} />
        </EndSlot>
      </LedgerRow>
      {open ? <ShareImageModal artistId={artistId} sources={sources} onClose={close} onSaved={setUrl} /> : null}
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
  const automatic = photos.filter((p) => !p.alt.trim()).length
  const meta = photos.length ? `${photos.length} ${photos.length === 1 ? 'photo' : 'photos'}${automatic ? ` · ${automatic} automatic` : ''}` : undefined
  return (
    <div id="alt" className="scroll-mt-28">
      <LedgerRow title="Alt text" guide="What Google Images reads." meta={meta}>
        {photos.length ? (
          <button type="button" aria-label="Open the photos" onClick={() => setOpen(true)} className={cx('flex gap-1.5 rounded-md', FOCUS_RING, 'focus-visible:outline-offset-2')}>
            {photos.slice(0, 6).map((p) => (
              <img key={p.id} src={p.url} alt="" className="block h-9 w-9 rounded-md border border-hairline object-cover" />
            ))}
          </button>
        ) : (
          <span className="font-space text-[12px] text-ink-faint">No photos on the site yet</span>
        )}
        <EndSlot>{photos.length ? <RowIcon icon="edit" label="Edit" onClick={() => setOpen(true)} /> : null}</EndSlot>
      </LedgerRow>
      {open && photos.length ? <AltModal artistId={artistId} artistName={artistName} photos={photos} onChange={setPhotos} onClose={close} /> : null}
    </div>
  )
}

/** One row per photo: the picture, its alt text (blank = the automatic one, shown faint) and
 *  its file name. Alt saves as it is typed; the file name when the field is left. */
function AltModal({ artistId, artistName, photos, onChange, onClose }: { artistId: string; artistName: string; photos: AltPhoto[]; onChange: (p: AltPhoto[]) => void; onClose: () => void }) {
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
  const rename = async (p: AltPhoto, raw: string) => {
    const slug = raw.trim()
    if (!slug || slug === p.slug) return
    const r = await renameMediaAction(artistId, p.id, slug)
    if (r.error) return setError(r.error)
    setError(null)
    if (r.storage_path) onChange(photos.map((x) => (x.id === p.id ? { ...x, slug: recommendSlug(slug), url: x.url.replace(/\/[^/]+(\?.*)?$/, `/${r.storage_path!.split('/').pop()}$1`) } : x)))
  }
  return (
    <CardModal open onClose={onClose} label="Alt text">
      <ModalHeader
        square={
          <div className="flex h-full w-full items-center justify-center rounded-xl border border-hairline text-ink">
            <Icon name="photo" size={26} />
          </div>
        }
        title="Alt text"
        meta={
          <>
            {`${photos.length} ${photos.length === 1 ? 'photo' : 'photos'}`}
            <MetaDot />
            Google Images
          </>
        }
      />
      <div className="mt-5">
        {photos.map((p) => {
          const preset = recommendAlt({ artist: artistName, caption: p.caption })
          return (
            <div key={p.id} className="flex items-center gap-4 border-b border-hairline-soft py-3 last:border-b-0">
              <img src={p.url} alt="" className="h-10 w-10 flex-none rounded-md object-cover" />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <LineField label={`Alt text for ${p.slug}`} value={p.alt} placeholder={preset} onChange={(val) => setAlt(p.id, val)} className="w-full" />
                <FileName photo={p} alt={p.alt || preset} onRename={(s) => void rename(p, s)} />
              </div>
            </div>
          )
        })}
        {error ? <FieldError>{error}</FieldError> : null}
      </div>
    </CardModal>
  )
}

function FileName({ photo, alt, onRename }: { photo: AltPhoto; alt: string; onRename: (slug: string) => void }) {
  const [draft, setDraft] = useState(photo.slug)
  return (
    <LineField
      label={`File name for ${photo.slug}`}
      value={draft}
      placeholder={recommendSlug(alt)}
      onChange={setDraft}
      onBlur={() => onRename(draft)}
      mono
      tone="faint"
      className="w-full"
    />
  )
}
