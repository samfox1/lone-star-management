'use client'

import { useEffect, useRef, useState } from 'react'
import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'
import { SOCIAL_PLATFORMS, type SocialPlatform } from '@samfox1/site-bridge/social'
import { socialIcon } from '@samfox1/site-bridge/social-icons'
import { modalCardClass, modalOverlayClass } from '@/components/ui/ui'
import { EYEBROW, FIELD } from './inspector-shared'
import { useLockBodyScroll } from '../use-lock-body-scroll'

/**
 * ADD A SOCIAL, without leaving the editor.
 *
 * Sam, 2026-08-09: "when they hit the add social button, a modal should come up instead
 * of redirecting the user to another page… I want the user to be able to choose from a
 * selector where we have a preexisting list of social links that they can add, that way
 * we have the icon preset."
 *
 * The footer used to be a `<Link>` to `/artists/[id]/links`, which threw away the whole
 * editor session — the frame, the scroll position, the panel you were in — to type one
 * URL. Two steps here instead: pick the platform, paste the URL.
 *
 * THE VOCABULARY IS CLOSED (Sam, 2026-08-10): "I would remove the possibility for an
 * unknown platform to be added. I dont want text to be on the site as a fallback with no
 * known site." Only `SOCIAL_PLATFORMS` can be added, so every social row carries a label
 * a site can map to a mark. The free-text escape hatch is gone with it — an unknown
 * platform had nothing to draw, so it rendered as the raw label sitting in a row of
 * icons, which is exactly the thing this row must never look like.
 *
 * The label IS the join key a connected site maps its icon by (`item:link:instagram`),
 * so a typed "insta" was never a lesser version of Instagram — it was a different,
 * unrenderable platform. `createContent` refuses one on the write side too; this picker
 * is the affordance, not the enforcement.
 */
export function AddSocialModal({
  existingLabels,
  onAdd,
  onCancel,
}: {
  /** Labels already on this artist, so a platform cannot be added twice — a second
   *  Instagram row would render two identical icons the manager cannot tell apart. */
  existingLabels: string[]
  /** Create the row. Resolves to an error string, or null on success. */
  onAdd: (label: string, url: string) => Promise<string | null>
  onCancel: () => void
}) {
  useLockBodyScroll(true)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  const taken = new Set(existingLabels.map((l) => l.trim().toLowerCase()))
  const [picked, setPicked] = useState<SocialPlatform | null>(null)
  const [url, setUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // THE LATCH IS A REF, not the `saving` state (AGENTS.md rule 5). Two fast clicks both
  // read pre-render state, and `disabled={saving}` only applies after React re-renders —
  // so a state-only guard let both through and inserted the link twice. The Enter key on
  // the URL field is a second door into the same race.
  const busyRef = useRef(false)

  const effectiveLabel = picked?.label ?? ''

  async function submit() {
    if (busyRef.current) return
    if (!effectiveLabel) return setError('Give this link a name.')
    const trimmed = url.trim()
    if (!trimmed) return setError('Paste the link’s URL.')
    // A picked platform prefills its `urlHint`, which is a bare platform root — non-empty,
    // so the check above waves it through and the site ships a link to instagram.com with
    // no handle on it. The manager has to have actually pasted something.
    if (picked !== null && trimmed === picked.urlHint) {
      return setError('Add the rest of the link — that’s just the site’s address.')
    }
    busyRef.current = true
    setSaving(true)
    setError(null)
    const err = await onAdd(effectiveLabel, trimmed)
    busyRef.current = false
    setSaving(false)
    if (err) setError(err)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add a social link"
      className={modalOverlayClass}
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div className={cx(modalCardClass, 'no-scrollbar w-[520px] gap-4')}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className={EYEBROW}>Add a social</div>
            <h2 className="mt-1 text-lg font-bold leading-tight tracking-[-0.01em]">
              {picked ? 'Where does it go?' : 'Pick a platform'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            className="flex-none rounded-md px-2 py-1 font-space text-[10px] font-bold uppercase tracking-[0.08em] text-ink-faint hover:text-ink"
          >
            Close
          </button>
        </div>

        {!picked ? (
          <div className="grid grid-cols-3 gap-2">
            {SOCIAL_PLATFORMS.map((p) => {
              const already = taken.has(p.slug)
              return (
                <button
                  key={p.slug}
                  type="button"
                  disabled={already}
                  aria-label={already ? `${p.label} (already added)` : p.label}
                  onClick={() => {
                    setPicked(p)
                    setUrl(p.urlHint)
                  }}
                  className={cx(
                    'flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-[13px] transition-colors',
                    already
                      ? 'cursor-not-allowed border-hairline-soft text-ink-faint'
                      : 'border-hairline hover:border-accent hover:text-accent',
                  )}
                >
                  <SocialMark slug={p.slug} />
                  <span className="truncate">{p.label}</span>
                </button>
              )
            })}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-[13px]">
              <SocialMark slug={picked.slug} />
              <span>{picked.label}</span>
              <button
                type="button"
                onClick={() => {
                  setPicked(null)
                  setError(null)
                }}
                className="ml-auto font-space text-[10px] font-bold uppercase tracking-[0.08em] text-ink-faint hover:text-ink"
              >
                Change
              </button>
            </div>

            <label className="block">
              <span className={EYEBROW}>URL</span>
              <input
                autoFocus
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
                aria-label="Link URL"
                className={cx(FIELD, 'mt-1')}
              />
            </label>

            {error && <p className="text-[12px] text-accent-red">{error}</p>}

            <button
              type="button"
              onClick={submit}
              disabled={saving}
              className="w-full rounded-lg bg-ink px-4 py-2.5 font-space text-[11px] font-bold uppercase tracking-[0.08em] text-paper disabled:opacity-60"
            >
              {saving ? 'Adding…' : 'Add to the site'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * A platform's brand mark, drawn MONOCHROME so it inherits the button's colour and
 * disabled/hover states like every other glyph in the inspector. The registry carries
 * each brand's own hex, but sixteen brand colours in one grid reads as a sticker sheet,
 * and the editor's chrome is deliberately achromatic (the dashboard's whole design).
 * A connected SITE is free to use the hex — that is its call, not the editor's.
 */
function SocialMark({ slug }: { slug: string }) {
  const icon = socialIcon(slug)
  if (!icon) return <Icon name="links" size={14} />
  return (
    <svg viewBox="0 0 24 24" width={14} height={14} fill="currentColor" aria-hidden className="flex-none">
      <path d={icon.path} />
    </svg>
  )
}
