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
import { useRef, useState } from 'react'
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
import { ControlRow, EditRow, EYEBROW, GroupLabel, PANEL_BODY, SaveLine } from '../inspector-shared'
import { useDebouncedFieldSave } from '../use-debounced-field-save'
import { fileNameOf, LibraryPicker, PhotoThumb } from '../inspector-grid'
import { GallerySlotUploader } from '../../media-uploader'
import type { AssetBudget } from '@/lib/site-editor/asset-budget'
import type { GalleryPhoto } from '../inspector-types'
import { saveArtistFactAction, saveCursorFieldAction, saveSeoFieldAction } from '../../actions'
import { ABOUT_PLACEMENTS, type AboutPlacement, type ManifestAbout } from '@samfox1/site-bridge/seo'

/** Derived, not hand-listed: a new style in the package shows up here on its own. */
const TRAIL_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Off' },
  ...CURSOR_TRAIL_STYLES.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) })),
]

/** Artist facts the fact sheet reads (artists.genre / location / schema_type). */
export type ArtistFacts = { genre: string; location: string; schema_type: string }

/**
 * One SEO/GEO text field, handed UP to be opened full-panel.
 *
 * `store` rides along because the two halves of this group save to different places —
 * `seo_*` through the SEO gate into site_content, `genre`/`location` onto the artist row.
 * The editor upstairs cannot infer that from a key, and inferring it wrong writes a
 * site_content row nothing reads (the ftbk bug, 2026-08-20).
 */
export type SiteTextField = {
  store: 'seo' | 'fact'
  key: string
  label: string
  value: string
  multiline?: boolean
}

export function SiteTools({
  artistId,
  photos,
  values: initial,
  seo: initialSeo = {},
  facts: initialFacts = { genre: '', location: '', schema_type: 'MusicGroup' },
  about = null,
  onEditBio,
  onEditText,
  swatches = [],
  budget = null,
  onApplyCursor,
}: {
  artistId: string
  /** The image library — cursors are picked from it (any uploaded PNG). */
  photos: GalleryPhoto[]
  /** Current cursor values from the draft's site_content, keyed by CURSOR_CONTENT_KEYS. */
  values: Record<string, string>
  /** Current SEO keys off the draft's site_content (seo_title, …, about_placement). */
  seo?: Record<string, string>
  facts?: ArtistFacts
  /** What the site declares about its bio; null = it shows none. */
  about?: ManifestAbout | null
  /** Opens the bio in the text editor (the ONE bio feeds About, meta and JSON-LD). */
  onEditBio?: () => void
  /** Opens one SEO/GEO text field full-panel, the way every other text row opens
   *  (Sam, 2026-09-09). Absent = the rows render but do nothing, which is the state a
   *  caller that has not wired it is in. */
  onEditText?: (field: SiteTextField) => void
  /** Site palette + already-used colours for the trail colour picker. */
  swatches?: string[]
  /** The site's image budget — the cursor uploader compresses like every other slot. */
  budget?: AssetBudget | null
  /** Live-preview hook: repaint the frame's cursor without waiting on the save. */
  onApplyCursor?: (settings: CursorSettings) => void
}) {
  const [vals, setVals] = useState<Record<string, string>>(initial)
  // This panel saves IMMEDIATELY (a cursor pick is a discrete choice, not a typing
  // burst), so it uses the hook's non-debounced `runNow` — the per-key serialization
  // (#6) and errored-set (#8) come along for free. `persist` (the debounced door) is
  // unused here.
  const { status, runNow } = useDebouncedFieldSave<string>({ persist: () => Promise.resolve() })
  // What the panel last painted, so a failed save reverts THIS key only — snapshotting
  // the whole `vals` object rolled back concurrent keys that had already committed.
  const latest = useRef<Record<string, string>>(initial)

  const save = (key: string, value: string) => {
    const before = latest.current[key] ?? ''
    latest.current = { ...latest.current, [key]: value }
    setVals(latest.current)
    onApplyCursor?.(cursorSettingsFrom(latest.current))
    runNow(key, () =>
      saveCursorFieldAction(artistId, key, value).then((res) => {
        if (res.ok) return
        // Revert the ONE key, in the panel and the frame — an optimistic cursor the
        // save refused would look applied until the next full refresh dropped it. Only
        // if a newer click hasn't already replaced this value (serialized per key, but
        // the map must not travel back in time).
        if (latest.current[key] === value) {
          latest.current = { ...latest.current, [key]: before }
          setVals(latest.current)
          onApplyCursor?.(cursorSettingsFrom(latest.current))
        }
        return { error: res.error }
      }),
    )
  }

  const trail = vals[CURSOR_CONTENT_KEYS.trail] ?? ''
  const wantsColor = trail !== '' && trail !== 'image'

  // SEO / GEO (SEO_GEO_PLAN B6). Strings save debounced like any typed field; the two
  // selects save at once. Optimistic, reverting to the mounted value on a refusal.
  const [seo, setSeo] = useState<Record<string, string>>(initialSeo)
  const [facts, setFacts] = useState<ArtistFacts>(initialFacts)
  const seoSave = useDebouncedFieldSave<string>({
    persist: (key, value) =>
      saveSeoFieldAction(artistId, key, value).then((r) => {
        if (!r.ok) setSeo((s) => ({ ...s, [key]: initialSeo[key] ?? '' }))
        return { ok: r.ok, error: r.error }
      }),
  })
  const factSave = useDebouncedFieldSave<string>({
    persist: (column, value) =>
      saveArtistFactAction(artistId, column as keyof ArtistFacts, value).then((r) => {
        if (!r.ok) setFacts((f) => ({ ...f, [column]: initialFacts[column as keyof ArtistFacts] }))
        return { ok: r.ok, error: r.error }
      }),
  })
  const setSeoKey = (key: string, value: string) => {
    setSeo((s) => ({ ...s, [key]: value }))
    seoSave.save(key, value)
  }
  const setFact = (column: keyof ArtistFacts, value: string) => {
    setFacts((f) => ({ ...f, [column]: value }))
    factSave.save(column, value)
  }
  // Derived from the site's declaration + the registry, never hand-listed: `hidden` is
  // always offered; `home`/`page` only when the site can render them.
  const placements: AboutPlacement[] = ABOUT_PLACEMENTS.filter((p) => p === 'hidden' || about?.placements.includes(p))
  const placementLabel: Record<AboutPlacement, string> = { home: 'On the homepage', page: 'Its own page', hidden: 'Hidden' }

  return (
    <>
      <GroupLabel>SEO / GEO</GroupLabel>
      <div className={PANEL_BODY}>
        <SeoEditRow store="seo" fieldKey="seo_title" label="Title" value={seo.seo_title ?? ''} onEdit={onEditText} />
        {/* The one the report was about: a description never fit the inline box, so the
            row shows a snippet and the words open full-panel. Multiline — a single-line
            input in a wider panel would move the clipping, not end it. */}
        <SeoEditRow store="seo" fieldKey="seo_description" label="Description" value={seo.seo_description ?? ''} multiline onEdit={onEditText} />
        <ControlRow label="Social card">
          <a href={`/artists/${artistId}/tools/seo`} className={`${EYEBROW} text-ink underline underline-offset-2`}>
            Open
          </a>
        </ControlRow>
        <ControlRow label="Bio">
          <button type="button" onClick={onEditBio} aria-label="Edit bio" className={`${EYEBROW} text-ink underline underline-offset-2`}>
            Edit
          </button>
        </ControlRow>
        <ControlRow label="About">
          <select
            aria-label="About placement"
            value={placements.includes(seo.about_placement as AboutPlacement) ? seo.about_placement : ''}
            onChange={(e) => setSeoKey('about_placement', e.target.value)}
            className={SELECT}
          >
            <option value="">{about?.default ? `Site default (${placementLabel[about.default]})` : 'Site default'}</option>
            {placements.map((p) => (
              <option key={p} value={p}>
                {placementLabel[p]}
              </option>
            ))}
          </select>
        </ControlRow>
        <SeoEditRow store="fact" fieldKey="genre" label="Genre" value={facts.genre} onEdit={onEditText} />
        <SeoEditRow store="fact" fieldKey="location" label="Location" value={facts.location} onEdit={onEditText} />
        <ControlRow label="Type">
          <select aria-label="Artist type" value={facts.schema_type || 'MusicGroup'} onChange={(e) => setFact('schema_type', e.target.value)} className={SELECT}>
            <option value="MusicGroup">Musician</option>
            <option value="Person">Visual artist</option>
          </select>
        </ControlRow>
      </div>

      <GroupLabel>Cursor</GroupLabel>
      <div className={PANEL_BODY}>
        <CursorImageRow
          label="Cursor"
          hint="Shown everywhere on the site"
          value={vals[CURSOR_CONTENT_KEYS.image] ?? ''}
          photos={photos}
          artistId={artistId}
          budget={budget}
          onChange={(url) => save(CURSOR_CONTENT_KEYS.image, url)}
        />
        <CursorImageRow
          label="Click cursor"
          hint="Swapped in while the mouse is down"
          value={vals[CURSOR_CONTENT_KEYS.click] ?? ''}
          photos={photos}
          artistId={artistId}
          budget={budget}
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
          {/* aria-pressed pills, not radio roles: radios promise arrow-key movement
              these independent buttons don't have (the frame-mode toggle precedent). */}
          <span className="flex flex-wrap justify-end gap-1">
            {TRAIL_OPTIONS.map((o) => (
              <button
                key={o.value || 'off'}
                type="button"
                aria-pressed={trail === o.value}
                aria-label={`Trail style: ${o.label}`}
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
      {/* The mono status line every panel ENDS with — same placement as the siblings. */}
      <SaveLine status={status} />
    </>
  )
}

/** One cursor slot: a small preview of the chosen PNG, Choose (library picker), Remove.
 *  The picker's footer is the same uploader the image slots use, so a cursor PNG that
 *  isn't in the library yet is one drop away — and it lands in the Images library too,
 *  which is where Sam said cursor files should live. */
const SELECT = 'w-[168px] rounded-md border border-hairline bg-paper px-2 py-1 font-space text-[11px] outline-none focus:border-accent'

/**
 * [label] [snippet] [pencil] — the row every other panel uses (EditRow), so "Edit" is one
 * gesture everywhere in the inspector. It replaced a label + inline `<input>`: a
 * description clipped mid-word in a 200px box, and the only way to read it was to click
 * in and arrow across (Sam, 2026-09-09, with a screenshot).
 */
function SeoEditRow({
  store,
  fieldKey,
  label,
  value,
  multiline,
  onEdit,
}: {
  store: 'seo' | 'fact'
  fieldKey: string
  label: string
  value: string
  multiline?: boolean
  onEdit?: (field: SiteTextField) => void
}) {
  return (
    <EditRow
      label={label}
      value={value || 'Not set'}
      empty={!value}
      editLabel={label}
      // Inside PANEL_BODY, which already pads. Without this the row steps 16px in from
      // the Social card / About / Type rows beside it (Sam, 2026-09-09).
      flush
      onEdit={() => onEdit?.({ store, key: fieldKey, label, value, multiline })}
    />
  )
}


function CursorImageRow({
  label,
  hint,
  value,
  photos,
  artistId,
  budget = null,
  onChange,
}: {
  label: string
  hint: string
  value: string
  photos: GalleryPhoto[]
  artistId: string
  /** The site's image budget, for the drop-a-PNG uploader in the picker. */
  budget?: AssetBudget | null
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
              budget={budget}
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
