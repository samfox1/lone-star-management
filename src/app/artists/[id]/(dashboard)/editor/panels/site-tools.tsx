/**
 * SITE panel — settings that belong to the whole site rather than any one region
 * (Sam, 2026-08-11: custom cursor, default and on click, plus a cursor trail). First
 * resident: the pointer. Future site-wide things (favicon, page transitions, loading
 * screen) land here rather than growing a ninth ad-hoc surface.
 *
 * Values are four ordinary site_content keys, saved one at a time through
 * saveCursorFieldAction (the validated write gate) and painted live over the bridge's
 * `apply-cursor` message. The labels/options derive from the package's constants —
 * the panel can't offer a trail the site applier doesn't know.
 */
import { useState } from 'react'
import {
  CURSOR_CONTENT_KEYS,
  CURSOR_TRAIL_STYLES,
  cursorSettingsFrom,
  type CursorSettings,
} from '@samfox1/site-bridge/cursor'
import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'
import { mediaUrl } from '@/lib/storage-url'
import { ColorPalette } from '../color-picker'
import { ControlRow, GroupLabel, PANEL_BODY, SaveLine, type SaveStatus } from '../inspector-shared'
import { fileNameOf, LibraryPicker, PhotoThumb } from '../inspector-grid'
import { GallerySlotUploader } from '../../media-uploader'
import type { GalleryPhoto } from '../inspector-types'
import { saveCursorFieldAction } from '../../actions'

/** Derived, not hand-listed: a new style in the package shows up here on its own. */
const TRAIL_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Off' },
  ...CURSOR_TRAIL_STYLES.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) })),
]

export function SiteTools({
  artistId,
  photos,
  values: initial,
  swatches = [],
  onApplyCursor,
}: {
  artistId: string
  /** The image library — cursors are picked from it (any uploaded PNG). */
  photos: GalleryPhoto[]
  /** Current cursor values from the draft's site_content, keyed by CURSOR_CONTENT_KEYS. */
  values: Record<string, string>
  /** Site palette + already-used colours for the trail colour picker. */
  swatches?: string[]
  /** Live-preview hook: repaint the frame's cursor without waiting on the save. */
  onApplyCursor?: (settings: CursorSettings) => void
}) {
  const [vals, setVals] = useState<Record<string, string>>(initial)
  const [status, setStatus] = useState<SaveStatus>('idle')

  const save = (key: string, value: string) => {
    const prev = vals
    const next = { ...vals, [key]: value }
    setVals(next)
    onApplyCursor?.(cursorSettingsFrom(next))
    setStatus('saving')
    saveCursorFieldAction(artistId, key, value).then((res) => {
      if (res.ok) return setStatus('saved')
      // Revert BOTH the panel and the frame — an optimistic cursor the save refused
      // would look applied right up until the next full refresh dropped it.
      setVals(prev)
      onApplyCursor?.(cursorSettingsFrom(prev))
      setStatus('error')
    })
  }

  const trail = vals[CURSOR_CONTENT_KEYS.trail] ?? ''
  const wantsColor = trail !== '' && trail !== 'image'

  return (
    <>
      <SaveLine status={status} />
      <GroupLabel>Cursor</GroupLabel>
      <div className={PANEL_BODY}>
        <CursorImageRow
          label="Cursor"
          hint="Shown everywhere on the site"
          value={vals[CURSOR_CONTENT_KEYS.image] ?? ''}
          photos={photos}
          artistId={artistId}
          onChange={(url) => save(CURSOR_CONTENT_KEYS.image, url)}
        />
        <CursorImageRow
          label="Click cursor"
          hint="Swapped in while the mouse is down"
          value={vals[CURSOR_CONTENT_KEYS.click] ?? ''}
          photos={photos}
          artistId={artistId}
          onChange={(url) => save(CURSOR_CONTENT_KEYS.click, url)}
        />
        <p className="pt-1 text-[10px] leading-snug text-ink-faint">
          Small PNGs with a transparent background work best — the site scales anything
          bigger down to 32px.
        </p>
      </div>

      <GroupLabel>Cursor trail</GroupLabel>
      <div className={PANEL_BODY}>
        <ControlRow label="Style">
          <span className="flex flex-wrap justify-end gap-1" role="radiogroup" aria-label="Trail style">
            {TRAIL_OPTIONS.map((o) => (
              <button
                key={o.value || 'off'}
                type="button"
                role="radio"
                aria-checked={trail === o.value}
                onClick={() => save(CURSOR_CONTENT_KEYS.trail, o.value)}
                className={cx(
                  'rounded-md border px-2 py-1 font-space text-[10px] font-bold uppercase tracking-[0.06em] transition-colors',
                  trail === o.value
                    ? 'border-ink bg-ink text-paper'
                    : 'border-hairline text-ink-muted hover:border-ink hover:text-ink',
                )}
              >
                {o.label}
              </button>
            ))}
          </span>
        </ControlRow>
        {trail === 'image' && !(vals[CURSOR_CONTENT_KEYS.image] ?? '') && (
          <p className="text-[10px] leading-snug text-status-pending">
            The image trail follows your cursor image — set one above first.
          </p>
        )}
        {wantsColor && (
          <ControlRow label="Trail color">
            <ColorPalette
              label=""
              aria="Cursor trail color"
              value={vals[CURSOR_CONTENT_KEYS.trailColor] ?? ''}
              used={swatches}
              onChange={(hex) => save(CURSOR_CONTENT_KEYS.trailColor, hex)}
            />
          </ControlRow>
        )}
      </div>
    </>
  )
}

/** One cursor slot: a small preview of the chosen PNG, Choose (library picker), Remove.
 *  The picker's footer is the same uploader the image slots use, so a cursor PNG that
 *  isn't in the library yet is one drop away — and it lands in the Images library too,
 *  which is where Sam said cursor files should live. */
function CursorImageRow({
  label,
  hint,
  value,
  photos,
  artistId,
  onChange,
}: {
  label: string
  hint: string
  value: string
  photos: GalleryPhoto[]
  artistId: string
  onChange: (url: string) => void
}) {
  const [picking, setPicking] = useState(false)
  return (
    <div className="flex items-center gap-3 py-2">
      <span
        className="flex h-10 w-10 flex-none items-center justify-center overflow-hidden rounded-[9px] border border-hairline bg-track"
        aria-hidden
      >
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element -- a 40px cursor preview
          <img src={value} alt="" className="max-h-8 max-w-8 object-contain" />
        ) : (
          <Icon name="photo" size={16} className="text-ink-faint" />
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[13px] font-medium">{label}</span>
        <span className="font-space text-[10px] tracking-[0.04em] text-ink-faint">{hint}</span>
      </span>
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label={`Remove ${label}`}
          className="font-space text-[11px] text-ink-muted underline underline-offset-2 hover:text-ink"
        >
          Remove
        </button>
      )}
      <button
        type="button"
        onClick={() => setPicking(true)}
        className="rounded-md border border-hairline px-2 py-1 font-space text-[10px] font-bold uppercase tracking-[0.06em] text-ink-muted hover:border-ink hover:text-ink"
      >
        {value ? 'Change' : 'Choose'}
      </button>
      {picking && (
        <LibraryPicker<GalleryPhoto>
          title={`Choose a ${label.toLowerCase()} image`}
          candidates={photos}
          keyOf={(p) => p.id}
          labelOf={(p) => fileNameOf(p.storage_path)}
          renderThumb={(p) => <PhotoThumb path={p.storage_path} aspect="aspect-square" />}
          empty={
            <p className="py-2 text-center text-xs text-ink-muted">
              No images in your library yet — drop a PNG below.
            </p>
          }
          footer={
            <GallerySlotUploader
              artistId={artistId}
              orientation="horizontal"
              label="Drop a cursor PNG or click to upload"
              onUploaded={(m) => {
                onChange(mediaUrl(m.storage_path))
                setPicking(false)
              }}
            />
          }
          onPick={(p) => {
            onChange(mediaUrl(p.storage_path))
            setPicking(false)
          }}
          onCancel={() => setPicking(false)}
        />
      )}
    </div>
  )
}
