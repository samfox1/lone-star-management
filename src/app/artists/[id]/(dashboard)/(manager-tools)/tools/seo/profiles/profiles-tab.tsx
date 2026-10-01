'use client'

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { cx } from '@/lib/cx'
import { slugify } from '@/lib/slug'
import { Icon, type IconName } from '@/components/ui/icons'
import { buildBioPack, ccAddress, emailText, mailtoHref, type BioPackInput } from '@/lib/manager-tools/seo/bio-pack'
import { HoverLabel } from '../../../_ui/row-icon'
import { FOCUS_RING } from '../../../_ui/focus-ring'
import { markProfileItemAction } from './actions'
import type { PackPhoto } from './load'

/**
 * PROFILES (Sam, 2026-09-30, prototypes/profiles_bio_pack_20260930.html): the artist's profiles
 * on other services that Tapir can't fill in by itself. One row each: a round mark, the name,
 * whether it was sent, a chevron. The first live one is the Apple Music & Amazon bio: an email to
 * AllMusic (Xperi), who write the bio both apps show. Its card holds the email, built in the
 * browser (bio-pack.ts) so a picked photo, its size and the CC change it at once:
 *
 *   TO · CC · SUBJECT · EMAIL · PHOTO · CHECK FIRST, then bare glyphs: Open in Mail, Copy email,
 *   Download photo, Mark as sent (or undo).
 *
 * The CC is the artist's own address, typed here and kept nowhere (Tapir doesn't store it, and
 * the booking email is often an agent's). Only one valid address is ever used (`ccAddress`).
 * The rows under it are the profiles still to come, greyed.
 */

const LATER = ['Bandsintown shows', 'Discogs', 'Resident Advisor', 'Wikidata'] as const

const LABEL = 'font-space text-[10.5px] font-bold uppercase leading-none tracking-[0.14em] text-ink-faint'
const ROW = 'flex w-full items-center gap-3.5 border-b border-hairline px-2.5 py-[13px] text-left'
const GLYPH = cx('relative inline-flex rounded p-1 text-ink transition-colors hover:text-accent disabled:cursor-default disabled:opacity-40 disabled:hover:text-ink', FOCUS_RING, 'focus-visible:outline-offset-2')

export type ProfilesTabProps = {
  artistId: string
  input: Omit<BioPackInput, 'photo'>
  photos: PackPhoto[]
  /** When "Mark as sent" was pressed (ISO), or null. */
  sentAt: string | null
  /** False when the marks couldn't be read: the row says nothing rather than "not sent". */
  marksOk: boolean
}

/** "sent Sep 30", in the manager's own time zone. */
function sentLabel(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? 'sent' : `sent ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
}

/** A Supabase storage file downloads (rather than opens) with `?download=<name>`; anything
 *  else falls back to the `download` attribute, which a browser honours on its own origin. */
function downloadHref(url: string, fileName: string): string {
  return url.includes('/storage/v1/object/public/') ? `${url}?download=${encodeURIComponent(fileName)}` : url
}

export function ProfilesTab({ artistId, input, photos, sentAt: initialSent, marksOk }: ProfilesTabProps) {
  const cardId = useId()
  const [sentAt, setSentAt] = useState<string | null>(initialSent)
  const [open, setOpen] = useState(!initialSent)

  return (
    <div className="mx-auto max-w-[800px] pt-10">
      <div className={LABEL}>Outside profiles</div>
      <div className="mt-3.5 border-t border-hairline">
        <button type="button" aria-expanded={open} aria-controls={cardId} onClick={() => setOpen((o) => !o)} className={cx(ROW, 'transition-colors hover:bg-surface-hover', FOCUS_RING, 'focus-visible:-outline-offset-2')}>
          <span aria-hidden="true" className={cx('flex h-4 w-4 flex-none items-center justify-center rounded-full border-[1.5px] border-ink', sentAt && 'bg-ink text-paper')}>
            {sentAt ? <Icon name="check" size={10} /> : null}
          </span>
          <span className="flex-1 text-[15px]">Apple Music &amp; Amazon bio</span>
          <span className="font-space text-[12px] text-ink-muted" suppressHydrationWarning>
            {marksOk ? (sentAt ? sentLabel(sentAt) : 'not sent') : ''}
          </span>
          <Icon name="chevronRight" size={16} className={cx('flex-none text-ink-faint transition-transform', open && 'rotate-90 text-ink')} />
        </button>
        {open ? (
          <BioCard
            id={cardId}
            artistId={artistId}
            input={input}
            photos={photos}
            sent={!!sentAt}
            canMark={marksOk}
            onMarked={(done) => setSentAt(done ? new Date().toISOString() : null)}
          />
        ) : null}
        {LATER.map((label) => (
          <div key={label} className={cx(ROW, 'text-ink-faint')}>
            <span aria-hidden="true" className="h-4 w-4 flex-none rounded-full border-[1.5px] border-dashed border-ink-faint" />
            <span className="flex-1 text-[15px]">{label}</span>
            <span className="font-space text-[12px]">later</span>
          </div>
        ))}
      </div>
      <div className="mt-2.5 text-center font-space text-[12px] text-ink-faint">Xperi writes the bio · usually takes months</div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1.5 border-t border-hairline-soft py-3 first:border-t-0 first:pt-0.5 min-[600px]:grid-cols-[120px_minmax(0,1fr)] min-[600px]:gap-[18px]">
      <span className={cx(LABEL, 'pt-[3px]')}>{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

function Glyph({ icon, label }: { icon: IconName; label: string }) {
  return (
    <>
      <Icon name={icon} size={18} aria-hidden="true" />
      <HoverLabel label={label} />
    </>
  )
}

function BioCard({
  id,
  artistId,
  input,
  photos,
  sent,
  canMark,
  onMarked,
}: {
  id: string
  artistId: string
  input: Omit<BioPackInput, 'photo'>
  photos: PackPhoto[]
  sent: boolean
  canMark: boolean
  onMarked: (done: boolean) => void
}) {
  const name = input.artist.name
  const [photoIndex, setPhotoIndex] = useState(0)
  const [picking, setPicking] = useState(false)
  const [size, setSize] = useState<{ url: string; width: number; height: number } | null>(null)
  const [cc, setCc] = useState('')
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const busyRef = useRef(false)

  const photo = photos[photoIndex] ?? null
  // The photo's pixel size isn't stored: read it from the file once it loads.
  useEffect(() => {
    if (!photo || size?.url === photo.url) return
    let gone = false
    const img = new Image()
    img.onload = () => {
      if (!gone && img.naturalWidth) setSize({ url: photo.url, width: img.naturalWidth, height: img.naturalHeight })
    }
    img.src = photo.url
    return () => {
      gone = true
    }
  }, [photo, size?.url])
  const dims = photo && size?.url === photo.url ? size : null

  const pack = useMemo(
    () => buildBioPack({ ...input, photo: photo ? { url: photo.url, type: photo.type, width: dims?.width, height: dims?.height } : null }, { cc }),
    [input, photo, dims, cc],
  )
  const ccBad = cc.trim() !== '' && !ccAddress(cc)

  async function copy() {
    try {
      await navigator.clipboard.writeText(emailText(pack, { cc }))
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      setError('Couldn’t copy.')
    }
  }

  async function mark() {
    // The latch is a ref (AGENTS.md rule 5): two fast clicks both read the pre-render state.
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    const done = !sent
    try {
      const r = await markProfileItemAction(artistId, 'allmusic_bio', done)
      if (r.ok) onMarked(done)
      else setError(r.error ?? 'Couldn’t save that.')
    } catch {
      setError('Couldn’t save that.')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const ext = photo?.type === 'PNG' ? 'png' : photo?.type === 'WebP' ? 'webp' : 'jpg'
  const fileName = `${slugify(name) || 'artist'}-press-photo.${ext}`

  return (
    <div id={id} className="mb-[18px] mt-1.5 rounded-[14px] border border-hairline bg-paper px-6 py-[22px] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <Field label="To">
        <div className="font-space text-[13px] leading-[1.7]">
          {pack.to.map((a) => (
            <div key={a}>{a}</div>
          ))}
        </div>
      </Field>
      <Field label="Cc">
        <input
          type="email"
          aria-label="Cc"
          aria-invalid={ccBad || undefined}
          value={cc}
          placeholder={`${name}’s email`}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setCc(e.target.value)}
          className={cx(
            'w-full min-w-0 border-b border-transparent bg-transparent p-0 font-space text-[13px] leading-[1.7] outline-none placeholder:text-ink-faint focus:border-ink',
            ccBad ? 'text-accent-red' : 'text-ink',
          )}
        />
      </Field>
      <Field label="Subject">
        <div className="font-space text-[13px] leading-[1.7]">{pack.subject}</div>
      </Field>
      <Field label="Email">
        <pre aria-label="Email" className="m-0 max-h-[320px] overflow-auto whitespace-pre-wrap rounded-[10px] bg-surface px-4 py-3.5 font-space text-[12px] leading-[1.65] text-ink">
          {pack.body}
        </pre>
      </Field>
      {photo ? (
        <Field label="Photo">
          <div className="flex items-center gap-3.5">
            {/* eslint-disable-next-line @next/next/no-img-element -- a storage preview, not a page image */}
            <img src={photo.thumb} alt="" className="h-16 w-16 flex-none rounded-lg bg-surface object-cover" />
            <div className="font-space text-[12px] leading-[1.6] text-ink-muted">
              <div>{[photo.type, dims ? `${dims.width} × ${dims.height}` : ''].filter(Boolean).join(' · ')}</div>
              {photos.length > 1 ? (
                <button type="button" aria-expanded={picking} onClick={() => setPicking((p) => !p)} className={cx('border-b border-hairline text-ink hover:text-accent', FOCUS_RING)}>
                  change
                </button>
              ) : null}
            </div>
          </div>
          {picking ? (
            <div role="group" aria-label="Photos" className="mt-3 flex flex-wrap gap-2">
              {photos.map((p, i) => (
                <button
                  key={p.url}
                  type="button"
                  aria-label={`Photo ${i + 1}`}
                  aria-pressed={i === photoIndex}
                  onClick={() => {
                    setPhotoIndex(i)
                    setPicking(false)
                  }}
                  className={cx('rounded-lg outline-offset-2', i === photoIndex ? 'outline-2 outline-solid outline-ink' : 'opacity-80 hover:opacity-100', FOCUS_RING)}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- a storage preview */}
                  <img src={p.thumb} alt="" className="h-12 w-12 rounded-lg bg-surface object-cover" />
                </button>
              ))}
            </div>
          ) : null}
        </Field>
      ) : null}
      {pack.checks.length ? (
        <Field label="Check first">
          <ul className="m-0 list-none p-0">
            {pack.checks.map((c) => (
              <li key={c.id} data-check={c.id} className="flex items-start gap-2.5 py-[3px] text-[13.5px]">
                <span aria-hidden="true" className="mt-[3px] flex w-5 flex-none justify-center">
                  <span className="h-[13px] w-[13px] rounded-full border-[1.6px] border-dashed border-ink-faint" />
                </span>
                <span>{c.text}</span>
              </li>
            ))}
          </ul>
        </Field>
      ) : null}
      <div className="mt-1.5 flex flex-wrap items-center gap-4 border-t border-hairline-soft pt-4">
        <a href={mailtoHref(pack, { cc })} aria-label="Open in Mail" className={GLYPH}>
          <Glyph icon="mailbox" label="Open in Mail" />
        </a>
        <button type="button" aria-label={copied ? 'Copied' : 'Copy email'} onClick={() => void copy()} className={GLYPH}>
          <Glyph icon={copied ? 'check' : 'copy'} label={copied ? 'Copied' : 'Copy email'} />
        </button>
        {photo ? (
          <a href={downloadHref(photo.url, fileName)} download={fileName} aria-label="Download photo" className={GLYPH}>
            <Glyph icon="download" label="Download photo" />
          </a>
        ) : null}
        {canMark ? (
          <button type="button" aria-label={sent ? 'Mark as not sent' : 'Mark as sent'} onClick={() => void mark()} disabled={busy} className={cx(GLYPH, 'ml-auto')}>
            <Glyph icon={sent ? 'replay' : 'check'} label={sent ? 'Mark as not sent' : 'Mark as sent'} />
          </button>
        ) : null}
        {error ? (
          <span role="alert" className="font-space text-[11px] text-accent-red">
            {error}
          </span>
        ) : null}
      </div>
    </div>
  )
}
