'use client'

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { cx } from '@/lib/cx'
import { slugify } from '@/lib/slug'
import { MAILTO_SAFE_LENGTH, buildBioPack, ccAddress, emailText, mailtoHref, type BioPackInput } from '@/lib/manager-tools/seo/profiles/bio-pack'
import { dayLabel } from '@/lib/manager-tools/seo/profiles/bio-state'
import { SAVE_FAILED } from '@/lib/manager-tools/format'
import { FOCUS_RING } from '../../../_ui/focus-ring'
import { ERROR_TEXT, MONO_META } from '../../../_ui/styles'
import { useNow } from '../_ui/clock'
import { CardAction, CardActions, Field, LABEL, ProfileCard, ProfileRow, QuietRow, RoundMark } from './_ui/profile-row'
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
 * Under it, `outside`: the live Discogs and Wikidata rows (outside-rows.tsx), then the profiles
 * still to come, greyed. Under the group, `bios`: the Outside bios and their "updated" ticks
 * (bio-rows.tsx).
 */

const LATER = ['Bandsintown shows', 'Resident Advisor'] as const

export type ProfilesTabProps = {
  artistId: string
  input: Omit<BioPackInput, 'photo'>
  photos: PackPhoto[]
  /** When "Mark as sent" was pressed (ISO), or null. */
  sentAt: string | null
  /** False when the marks couldn't be read: the row says nothing rather than "not sent". */
  marksOk: boolean
  /** The live Discogs and Wikidata rows, streamed in by the page (outside-rows.tsx). */
  outside?: ReactNode
  /** The Outside bios group, under everything (bio-rows.tsx). */
  bios?: ReactNode
}

/** "sent Sep 30", in the viewer's time zone; plain "sent" before mount (`now` null on the
 *  server, so a server in UTC never prints another day). */
function sentLabel(iso: string, now: number | null): string {
  const day = now != null ? dayLabel(iso, now) : ''
  return day ? `sent ${day}` : 'sent'
}

/** A Supabase storage file downloads (rather than opens) with `?download=<name>`; anything
 *  else falls back to the `download` attribute, which a browser honours on its own origin. */
function downloadHref(url: string, fileName: string): string {
  return url.includes('/storage/v1/object/public/') ? `${url}?download=${encodeURIComponent(fileName)}` : url
}

export function ProfilesTab({ artistId, input, photos, sentAt: initialSent, marksOk, outside, bios }: ProfilesTabProps) {
  const cardId = useId()
  const [sentAt, setSentAt] = useState<string | null>(initialSent)
  const [open, setOpen] = useState(!initialSent)
  const now = useNow(false)

  return (
    <div className="mx-auto max-w-[800px] pt-10">
      <div className={LABEL}>Outside profiles</div>
      <div className="mt-3.5 border-t border-hairline">
        <ProfileRow
          open={open}
          controls={cardId}
          onToggle={() => setOpen((o) => !o)}
          mark={<RoundMark done={!!sentAt} />}
          name="Apple Music & Amazon bio"
          status={marksOk ? (sentAt ? sentLabel(sentAt, now) : 'not sent') : ''}
        />
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
        {outside}
        {LATER.map((label) => (
          <QuietRow key={label} name={label} status="later" later />
        ))}
      </div>
      <div className="mt-2.5 text-center font-space text-[12px] text-ink-faint">Xperi writes the bio · usually takes months</div>
      {bios}
    </div>
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
  const mailHref = mailtoHref(pack, { cc })

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
      else setError(r.error ?? SAVE_FAILED)
    } catch {
      setError(SAVE_FAILED)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const ext = photo?.type === 'PNG' ? 'png' : photo?.type === 'WebP' ? 'webp' : 'jpg'
  const fileName = `${slugify(name) || 'artist'}-press-photo.${ext}`

  return (
    <ProfileCard id={id}>
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
      <CardActions>
        <CardAction icon="mailbox" label="Open in Mail" href={mailHref} />
        {/* A long mailto can be cut short by the mail app without a word: Copy keeps all of it. */}
        {mailHref.length > MAILTO_SAFE_LENGTH ? <span className={cx('-ml-2', MONO_META)}>may be cut off · use Copy</span> : null}
        <CardAction icon={copied ? 'check' : 'copy'} label={copied ? 'Copied' : 'Copy email'} onClick={() => void copy()} />
        {photo ? <CardAction icon="download" label="Download photo" href={downloadHref(photo.url, fileName)} download={fileName} /> : null}
        {canMark ? (
          <CardAction icon={sent ? 'replay' : 'check'} label={sent ? 'Mark as not sent' : 'Mark as sent'} onClick={() => void mark()} disabled={busy} className="ml-auto" />
        ) : null}
        {error ? (
          <span role="alert" className={ERROR_TEXT}>
            {error}
          </span>
        ) : null}
      </CardActions>
    </ProfileCard>
  )
}
