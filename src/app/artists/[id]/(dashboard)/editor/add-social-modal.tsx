'use client'

import { useEffect, useState } from 'react'
import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'
import { SOCIAL_PLATFORMS, type SocialPlatform } from '@samfox1/site-bridge/social'
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
 * PICKING A PLATFORM IS THE POINT. A free-text label lands in the payload as whatever
 * was typed, and a connected site maps its icon by that label — so "insta" or "IG"
 * silently renders as an unrecognized link. Choosing from `SOCIAL_PLATFORMS` (the
 * package's shared vocabulary) means the label the site joins on is always one the site
 * can recognize. "Something else" stays, because an artist will always have somewhere we
 * have not heard of; it just renders as a plain labelled link.
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
  const [picked, setPicked] = useState<SocialPlatform | 'other' | null>(null)
  const [label, setLabel] = useState('')
  const [url, setUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const effectiveLabel = picked === 'other' ? label.trim() : (picked?.label ?? '')

  async function submit() {
    if (saving) return
    if (!effectiveLabel) return setError('Give this link a name.')
    if (!url.trim()) return setError('Paste the link’s URL.')
    setSaving(true)
    setError(null)
    const err = await onAdd(effectiveLabel, url.trim())
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
                  {/* One neutral glyph for now. The registry is the contract; per-platform
                      brand marks are an asset job, and a WRONG mark is worse than none. */}
                  <Icon name="links" size={14} />
                  <span className="truncate">{p.label}</span>
                </button>
              )
            })}
            <button
              type="button"
              onClick={() => setPicked('other')}
              className="flex items-center gap-2 rounded-lg border border-dashed border-hairline px-3 py-2.5 text-left text-[13px] hover:border-accent hover:text-accent"
            >
              <Icon name="plus" size={14} />
              <span className="truncate">Something else</span>
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-[13px]">
              <Icon name="links" size={14} />
              <span>{picked === 'other' ? 'Something else' : picked.label}</span>
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

            {picked === 'other' && (
              <label className="block">
                <span className={EYEBROW}>Name</span>
                <input
                  autoFocus
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  aria-label="Link name"
                  placeholder="Newsletter"
                  className={cx(FIELD, 'mt-1')}
                />
              </label>
            )}

            <label className="block">
              <span className={EYEBROW}>URL</span>
              <input
                autoFocus={picked !== 'other'}
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
