'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PublicSitePayload, SiteContent } from '@/lib/site'
import { DEVICE_OPTIONS, fitViewport, isPhone, zoomLabel, type Device } from '@/lib/site-editor/viewport'
import type { TemplateManifest } from '@/lib/site-editor/manifest'
import { bridgeOutdated } from '@/lib/site-editor/manifest'
import { textPanelEntries } from '@/lib/site-editor/text-panel'
import { mediaUrl } from '@/lib/storage-url'
import { withStyleVars, withUploadedFonts } from '@/lib/site-editor/style-controls'
import { resolvePanelInputs } from '@/lib/site-editor/panel-inputs'
import { CURSOR_KEYS, SEO_FIELDS } from '@/lib/site-content-schema'
import type { FrameMode } from '@samfox1/site-bridge/protocol'
import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'
import { EditorPublish } from './editor-publish'
import { RestoreVersionMenu } from './restore-version'
import { useFrameBridge } from './use-frame-bridge'
import { saveEditorFieldAction } from '../actions'
import { toast } from '../toast'
import {
  EditorInspector,
  type EditorImageField,
  type EditorLink,
  type EditorMerch,
  type EditorProject,
  type EditorSupportLink,
  type EditorTour,
  type EditorTextField,
  type EditorVideo,
  type GalleryPhoto,
} from './editor-inspector'

/**
 * The Text panel's fields for a CUSTOM site — the ones its frame declared over the
 * bridge. page.tsx cannot produce these: it only knows the built-in MANIFESTS, and the
 * artist's `template` column names one of those even when the site being edited is the
 * artist's own. Text was the last category still reading that local manifest, so a custom
 * site's own headings and captions had no control anywhere in the editor.
 *
 * A custom manifest's fields carry no `target`: the field KEY is the site_content key,
 * so the current value is a plain lookup rather than `fieldCurrentValue` (which reads
 * `field.target.store` and would throw on a targetless field). Text/email only — an image
 * field is edited as an image, and a text box holding an image URL is a worse bug than a
 * missing control. The manifest is untrusted cross-origin JSON, so `fields` may be
 * absent entirely (older skeen builds announce only `styles`).
 */
export function runtimeTextFields(
  manifest: TemplateManifest | null,
  values: SiteContent,
  /** The draft, for fields whose declared target is an ARTIST column (name/bio) —
   *  their value lives there, not in site_content (ftbk, 2026-08-20). */
  draft?: PublicSitePayload | null,
): EditorTextField[] {
  const artistTarget = (f: { target?: unknown } | null | undefined) => {
    const t = f?.target as { store?: string; column?: string } | undefined
    return t?.store === 'artist' && (t.column === 'name' || t.column === 'bio')
      ? { store: 'artist' as const, column: t.column as 'name' | 'bio' }
      : undefined
  }
  return textPanelEntries(manifest?.fields, manifest?.styles).map((e) => ({
    key: e.key,
    label: e.label,
    type: (e.field?.type === 'email' ? 'email' : 'text') as 'text' | 'email',
    target: artistTarget(e.field),
    value: (() => {
      const t = artistTarget(e.field)
      if (t) return (draft?.artist?.[t.column] as string | null) ?? ''
      return e.field ? (values[e.field.key] ?? '') : ''
    })(),
    // Same multiline rule the built-in path uses, so a body-copy field gets a textarea
    // on a custom site too.
    multiline: e.key === 'artist_bio' || e.key.endsWith('_copy'),
    styleRegion: e.styleRegion
      ? { key: e.styleRegion.key, label: e.styleRegion.label, base: e.styleRegion.base }
      : null,
    // A region with no field behind it: restyleable, not retypeable.
    styleOnly: !e.field,
    // What the SITE renders when the row is unset. A custom site keeps its fallbacks in
    // code, so its manifest is the only place we can learn them — without this the panel
    // lists a page full of words as "Empty".
    defaultValue: e.field?.defaultValue,
  }))
}

/**
 * The Images panel's single-occupancy slots for a CUSTOM site — the twin of
 * `runtimeTextFields`, and added for the same reason one category later.
 *
 * Sam, 2026-08-09, clicking the portrait on a throwaway site: "I click on the portrait
 * image and it doesnt take me to any image slot in the left editor." Styles, links,
 * slots and components all read the announced manifest; text was wired in 2026-08-05;
 * images alone still read the SERVER-resolved prop, which is necessarily empty for a
 * custom site because `manifestFor` only knows the built-in templates. So the click
 * routed to a panel with nothing in it.
 *
 * The preview comes from the DRAFT the editor already holds — a custom site's media
 * rows ride `init-data`, so no extra fetch is needed. Same two targets page.tsx accepts,
 * because those are the only single-occupancy image homes the wire models; anything else
 * a site declares is a component slot and belongs to that machinery.
 */
export function runtimeImageFields(
  manifest: TemplateManifest | null,
  draft: PublicSitePayload | null,
): EditorImageField[] {
  const profilePath = draft?.media?.find((m) => m.purpose === 'profile_photo')?.path
  const out: EditorImageField[] = []
  for (const f of manifest?.fields ?? []) {
    if (f.type !== 'image' || !f.target) continue
    // The target literals are rebuilt rather than passed through: the manifest is
    // untrusted cross-origin JSON typed with the WIDER FieldTarget union (`column` may
    // be name/bio), and EditorImageField accepts only the two save targets that exist.
    if (f.target.store === 'artist' && f.target.column === 'hero_image_url') {
      out.push({
        key: f.key,
        label: f.label,
        previewUrl: draft?.artist?.hero_image_url ?? null,
        target: { store: 'artist', column: 'hero_image_url' },
      })
    } else if (f.target.store === 'media' && f.target.purpose === 'profile_photo') {
      out.push({
        key: f.key,
        label: f.label,
        previewUrl: profilePath ? mediaUrl(profilePath) : null,
        target: { store: 'media', purpose: 'profile_photo' },
      })
    }
  }
  return out
}

/**
 * The visual editor shell (SITE_EDITOR_PLAN.md phase 2). Sits full-bleed below the
 * dashboard nav: the LEFT inspector (component browser + tools) and the artist's
 * real site in an embedded frame. The frame's controls — device, save status,
 * Publish — float in the gap above the centered window (no toolbar bar).
 *
 * TWO FRAME KINDS (SITE_STYLING_PLAN.md S4):
 *  - built-in template → same-origin `/artists/[id]/edit-frame`, which fetches its
 *    own draft server-side under RLS. No data is posted to it.
 *  - custom site (`site_kind='custom'`) → the artist's own `custom_site_url/edit`,
 *    CROSS-ORIGIN. It has no access to our DB, so we hand it the draft over the
 *    bridge (`init-data`) once it announces `ready` (D-C). `ready` is the trigger,
 *    not the iframe's `load`: load can fire before the frame's bridge has mounted,
 *    and the message would be dropped.
 *
 * Origin discipline: every postMessage targets the FRAME's origin (never `*`), and
 * every inbound message is checked against it before we trust the payload — the
 * bridge's source/version guards are a shape check, not an origin check.
 */
export function EditorShell({
  artistId,
  customSiteUrl,
  hasUnpublished = false,
  draft,
  photos,
  imageFields,
  textFields,
  siteContent = {},
  links,
  supportLinks,
  linkValues,
  videos,
  merch,
  releases,
  tours,
  uploadedFonts = [],
}: {
  artistId: string
  /** The artist's external site origin when `site_kind='custom'`, else null. */
  customSiteUrl?: string | null
  /** Draft differs from the last published edition — keeps Revert changes visible. */
  hasUnpublished?: boolean
  /** The draft to inject into a custom frame, in the wire shape. Null for a
   *  built-in template, which reads its own draft server-side. */
  draft?: PublicSitePayload | null
  photos: GalleryPhoto[]
  /** Single-occupancy image fields (hero image, profile photo) — the "Set slots" group.
   *  BUILT-IN templates only: page.tsx resolves them from the local manifest. A CUSTOM
   *  site's are rebuilt from its ANNOUNCED manifest instead (`runtimeImageFields`), the
   *  same discriminator the Text panel uses — page.tsx cannot produce them, since
   *  `manifestFor` only knows the built-in templates. skeen declares none and passes []
   *  either way: its images are component slots + gallery, and its hero is a video. */
  imageFields: EditorImageField[]
  /** Text fields page.tsx resolved from the artist's LOCAL template manifest. Used only
   *  for a built-in site: a custom site's are DROPPED in favour of the frame's own
   *  manifest (see the `fields` memo) — they describe a template it does not render. */
  textFields: EditorTextField[]
  /** The draft `site_content` map, for pairing a CUSTOM site's runtime manifest fields
   *  with their current values (a custom field's key IS its site_content key). */
  siteContent?: SiteContent
  links: EditorLink[]
  supportLinks: EditorSupportLink[]
  /** Current URL for each manifest link region, keyed by its role (from the DB). The
   *  regions themselves come from the frame's manifest at runtime. */
  linkValues: Record<string, string>
  videos: EditorVideo[]
  merch: EditorMerch[]
  releases: EditorProject[]
  tours: EditorTour[]
  /** Fonts uploaded on the Brand page, folded into the frame manifest's font options so
   *  every region's font dropdown offers them (Sam's per-region override model). */
  uploadedFonts?: { family: string; label: string }[]
}) {
  const [device, setDevice] = useState<Device>('desktop')
  // The pause/play toggle's own belief; the frame is told, never asked (see the button).
  const [mediaPlaying, setMediaPlaying] = useState(true)
  const panelRef = useRef<HTMLDivElement>(null)
  const [panel, setPanel] = useState({ w: 0, h: 0 })

  // Everything about talking to the frame — origin discipline, the ready→init-data
  // handshake, select routing — lives behind this hook, where it's testable.
  // Destructured, not held as an object: the react-hooks/refs rule rejects reaching
  // through a member expression for a ref during render.
  const {
    frameRef,
    src: frameSrc,
    applyField,
    applyImage,
    applyStyle,
    applyLink,
    applyCursor,
    setPlayback,
    applyHighlight,
    clearHighlight,
    setMode,
    frameMode,
    manifest,
    framePage,
    setPage,
    selectedStyle,
    selectedLink,
    selectedRegion,
    measuredRegion,
    requestMeasure,
    deselectedAt,
  } = useFrameBridge({
    artistId,
    customSiteUrl,
    draft,
    // The site saved a declared field by the manager acting on the page (0.27.0 —
    // ftbk's desktop arrangement). Straight to the SAME server action a typed field
    // uses: draft now, public on publish, no separate save path to drift.
    onFieldChange: useCallback(
      (key: string, value: string) => {
        void saveEditorFieldAction(artistId, key, value).then((res) => {
          if (!res.ok) toast(res.error ?? 'Could not save the layout.', 'error')
        })
      },
      [artistId],
    ),
  })

  // Measure the frame panel so the canvas can be scaled to fit it. The panel
  // resizes with the window (and would with a collapsible inspector), so observe
  // rather than measure once.
  useEffect(() => {
    const el = panelRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setPanel({ w: width, h: height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const view = fitViewport(device, panel.w, panel.h)

  // Text is the last category to read the BRIDGED manifest — styles, links, slots and
  // EVERY panel's manifest-derived input, resolved in ONE place (lib/site-editor/
  // panel-inputs.ts). Each category used to be wired here by hand, and each miss was
  // invisible until somebody clicked: text was the category left out in 2026-08-05,
  // images in 2026-08-09. The registry there makes a new category a compile error until
  // it names a consumer, and tests/panel-inputs.test.ts proves none of them resolve empty.
  /** Switch modes: tell the frame, and drop the editor's own selection on the way out —
   *  a panel still showing a selected region while clicks work the site reads as a
   *  control that has stopped responding. */
  const setFrameMode = (m: FrameMode) => {
    setMode(m) // the hook owns the state — it must survive frame reloads (see the hook)
    if (m === 'browse') clearHighlight()
  }

  // The Site panel's current values, straight off the draft's site_content — the same
  // map the frame renders from, so the panel and the preview can't disagree on mount.
  const cursorValues = useMemo(() => {
    const content = (draft?.site_content ?? siteContent ?? {}) as Record<string, string>
    return Object.fromEntries(CURSOR_KEYS.map((k) => [k, content[k] ?? '']))
  }, [draft, siteContent])
  // SEO keys the same way — derived from SEO_FIELDS, never listed here.
  const seoValues = useMemo(() => {
    const content = (draft?.site_content ?? siteContent ?? {}) as Record<string, string>
    return Object.fromEntries(SEO_FIELDS.map((f) => [f.key, content[f.key] ?? '']))
  }, [draft, siteContent])
  const artistFacts = useMemo(() => {
    const a = (draft?.artist ?? {}) as { genre?: string | null; location?: string | null; schema_type?: string | null }
    return { genre: a.genre ?? '', location: a.location ?? '', schema_type: a.schema_type ?? 'MusicGroup' }
  }, [draft])

  const panels = useMemo(
    () =>
      resolvePanelInputs({
        customSiteUrl,
        manifest,
        // The page the FRAME is showing (P2/D5). Page-scoped categories narrow to it, so
        // the Style panel on About lists About's regions rather than all forty of Home's,
        // every one of which would highlight nothing — the element is not in the frame.
        page: framePage,
        draft: draft ?? null,
        siteContent,
        local: { textFields, imageFields },
        derive: { textFields: runtimeTextFields, imageFields: runtimeImageFields },
      }),
    [customSiteUrl, manifest, framePage, draft, siteContent, textFields, imageFields],
  )

  return (
    // Cancel the dashboard main padding so the editor is full-bleed below the nav.
    <div className="-mx-7 -my-8 flex h-[calc(100vh-4rem)] border-t border-hairline">
      <EditorInspector
        artistId={artistId}
        bridgeOutdated={bridgeOutdated(manifest?.bridgeVersion)}
        pages={manifest?.pages}
        framePage={framePage}
        onSelectPage={setPage}
        hasUnpublished={hasUnpublished}
        photos={photos}
        imageFields={panels.imageFields}
        textFields={panels.textFields}
        links={links}
        supportLinks={supportLinks}
        videos={videos}
        merch={merch}
        releases={releases}
        tours={tours}
        components={panels.components}
        videoSlots={panels.videoSlots}
        imageCollections={panels.imageCollections}
        itemStyling={panels.itemStyling}
        assetBudgets={panels.assetBudgets}
        styleRegions={panels.styleRegions}
        styleValues={draft?.styles ?? {}}
        styleOptions={{
          ...withStyleVars(
            withUploadedFonts(panels.styleOptions, uploadedFonts),
            manifest?.bridgeVersion,
          ),
          // The device toggle scopes Size/Padding: phone view writes the …sm-[…] twin.
          mobileView: isPhone(device),
        }}
        selectedStyle={selectedStyle}
        measuredRegion={measuredRegion}
        onRequestMeasure={requestMeasure}
        deselectedAt={deselectedAt}
        linkRegions={panels.linkRegions}
        linkValues={linkValues}
        selectedLink={selectedLink}
        selectedRegion={selectedRegion}
        cursorValues={cursorValues}
        seoValues={seoValues}
        artistFacts={artistFacts}
        manifestAbout={manifest?.about ?? null}
        onApplyField={applyField}
        onApplyImage={applyImage}
        onApplyStyle={applyStyle}
        onApplyLink={applyLink}
        onApplyCursor={applyCursor}
        onHighlight={applyHighlight}
        onClearHighlight={clearHighlight}
      />

      <div className="flex min-w-0 flex-1 flex-col bg-surface p-3">
        <div className="flex h-full w-full flex-col gap-2.5">
          {/* Floating controls: device, status, Publish — no toolbar bar. */}
          <div className="flex items-center gap-3 px-0.5">
            <label className="sr-only" htmlFor="editor-device">
              Preview device
            </label>
            <select
              id="editor-device"
              value={device}
              onChange={(e) => setDevice(e.target.value as Device)}
              className="rounded-lg border border-hairline bg-paper px-2.5 py-1.5 font-space text-[10px] font-bold uppercase tracking-[0.08em] text-ink-faint outline-none hover:text-ink focus:border-ink-faint"
            >
              {DEVICE_OPTIONS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>

            {/* EDIT vs BROWSE. Every click on a marked region is swallowed in edit mode so
                selecting never also fires the app underneath — which left a site with
                NAVIGATION unbrowsable: on a tabbed site each click just selected the tab
                button (Sam, 2026-08-10). Browse hands the site back its own clicks. */}
            <div className="flex overflow-hidden rounded-lg border border-hairline">
              {(['edit', 'browse'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setFrameMode(m)}
                  aria-pressed={frameMode === m}
                  className={cx(
                    'px-2.5 py-1.5 font-space text-[10px] font-bold uppercase tracking-[0.08em]',
                    frameMode === m ? 'bg-ink text-paper' : 'bg-paper text-ink-faint hover:text-ink',
                  )}
                >
                  {m}
                </button>
              ))}
            </div>

            {/* ENTRANCES PAUSED (Sam, 2026-08-12): the replay button rests with them —
                see motionControls() in style-controls.ts for the blocker and what
                resuming needs (the bridge's replay-entrances message still exists). */}

            {/* One switch for every playing video in the preview — background clips
                loop loudly under the whole editing session otherwise. State lives
                here, not in the frame: a reloaded frame starts playing again, and the
                icon following the editor's own last request is the honest one. Icon
                shows the ACTION (pause while playing), like every media player. */}
            <button
              type="button"
              aria-pressed={!mediaPlaying}
              aria-label={mediaPlaying ? 'Pause all videos' : 'Play all videos'}
              title={mediaPlaying ? 'Pause all videos' : 'Play all videos'}
              onClick={() => {
                const next = !mediaPlaying
                setMediaPlaying(next)
                setPlayback(next)
              }}
              className="flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-hairline bg-paper text-ink-faint hover:text-ink"
            >
              <Icon name={mediaPlaying ? 'pause' : 'play'} size={13} />
            </button>

            {/* The canvas is a real 1440px desktop window drawn smaller, so say so —
                otherwise a zoomed-out site reads as "the text is broken". */}
            <span className="font-space text-[10px] font-bold uppercase tracking-[0.12em] text-ink-faint">
              {view.width}px · {zoomLabel(view.scale)}
            </span>

            <span className="flex-1" />

            {/* No global save chip here — the real per-field status ('Saving…/Saved/Failed')
                lives in each inspector tool; a hardcoded chip would just lie. */}
            {/* Publish and its overflow menu are ONE group, tighter than the toolbar's
                own gap-3 (Sam, 2026-08-15): the three dots belong to Publish, and spacing
                is what says so. Restore version lives here rather than on the inspector's
                Remove-changes button because it reaches past the session into what
                visitors have already seen — the same idea Publish belongs to. */}
            <div className="flex items-center gap-1.5">
              <EditorPublish artistId={artistId} />
              <RestoreVersionMenu artistId={artistId} />
            </div>
          </div>

          {/* The frame renders at a TRUE desktop width and is scaled down to fit,
              rather than being squeezed into the panel's ~900px — which would trip
              the site's tablet breakpoints and show a layout no desktop visitor
              gets. `overflow-hidden` clips the scaled canvas; the outer box is
              sized to the RENDERED dimensions so layout stays honest.
              NOTE for the selection overlay (still to come): the frame reports
              rects in its own 1440-space, so multiply them by `view.scale` before
              drawing over the top. */}
          <div ref={panelRef} className="flex min-h-0 flex-1 justify-center">
            <div
              className="relative overflow-hidden rounded-xl border border-hairline bg-paper shadow-sm"
              style={{ width: view.renderedWidth || '100%', height: view.renderedHeight || '100%' }}
            >
              <iframe
                ref={frameRef}
                src={frameSrc}
                title="Site editor"
                // The `autoplay` permission policy defaults to `self`, which a
                // SAME-ORIGIN built-in frame inherits and a cross-origin custom site does
                // not — so a connected site's hero clip could never start, and skeen sat
                // behind its own blurred placeholder in the preview (Sam, 2026-08-08).
                // Granted narrowly: autoplay only, and only to whatever this frame loads.
                allow="autoplay"
                className="absolute left-0 top-0 border-0"
                style={{
                  width: view.width,
                  height: view.height,
                  transform: `scale(${view.scale})`,
                  transformOrigin: 'top left',
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
