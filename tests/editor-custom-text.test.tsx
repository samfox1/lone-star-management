// @vitest-environment jsdom
/**
 * CUSTOM-SITE TEXT FIELDS — the Text panel for a site whose manifest arrives over the
 * BRIDGE at runtime (skeen), rather than from the local MANIFESTS registry.
 *
 * The bug this pins (reported by the skeen-website team, 2026-08-05): text was the ONE
 * editable category never wired to the bridged manifest — styles, links, slots and
 * components all read it. page.tsx resolved text fields from
 * `manifestFor(artist.template)` instead, so a custom site's own headings and captions
 * had no control anywhere in the editor.
 *
 * WATCH THE DISCRIMINATOR. It is `customSiteUrl`, not "manifestFor returned nothing":
 * `artists_template_check` allows only 'classic'/'cinematic', so a custom artist still
 * carries one (skeen is 'cinematic' + site_kind='custom') and a manifest ALWAYS resolves.
 * A "no local manifest" test would pass against a case that cannot occur while the real
 * one stayed broken.
 *
 * Both halves fail SILENTLY: the panel showed the built-in template's fields, which reads
 * as a working editor right up until a manager types in one and nothing on the site
 * changes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { EditorShell, runtimeTextFields } from '@/app/artists/[id]/(dashboard)/editor/editor-shell'
import type { EditorTextField } from '@/app/artists/[id]/(dashboard)/editor/inspector-types'
import type { TemplateManifest } from '@/lib/site-editor/manifest'
import { BRIDGE_VERSION, FRAME_SOURCE } from '@/lib/site-editor/bridge'
import type { PublicSitePayload } from '@/lib/site'

vi.mock('@/app/artists/[id]/(dashboard)/actions', () => ({
  deleteMediaAction: vi.fn(async () => ({})),
  reorderGalleryAction: vi.fn(async () => ({})),
  saveEditorFieldAction: vi.fn(async () => ({ ok: true })),
  saveEditorStyleAction: vi.fn(async () => ({ ok: true })),
  saveEditorLinkAction: vi.fn(async () => ({ ok: true })),
  updateContentAction: vi.fn(async () => ({})),
  deleteContentAction: vi.fn(async () => ({})),
  reorderContentAction: vi.fn(async () => ({})),
  renameVideoAction: vi.fn(async () => ({})),
  setOnSiteAction: vi.fn(async () => ({})),
  placeGalleryPhotoAction: vi.fn(async () => ({})),
  setSupportUrlAction: vi.fn(async () => ({})),
  assignHeroSlotAction: vi.fn(async () => ({})),
  assignComponentSlotAction: vi.fn(async () => ({})),
  setSongsOnSiteAction: vi.fn(async () => ({})),
  setImageFieldAction: vi.fn(async () => ({ ok: true })),
  getUnpublishedDiffAction: vi.fn(async () => ({})),
  publishAllGatedAction: vi.fn(async () => ({})),
}))
vi.mock('@/app/artists/[id]/(dashboard)/media-uploader', () => ({
  MediaUploader: () => null,
  GallerySlotUploader: () => null,
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

// The shell measures its frame panel with a ResizeObserver; jsdom has none.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
)

const CUSTOM = 'https://skeen-website.vercel.app'

/** A custom site's runtime manifest, as skeen posts it on `ready`. Its fields carry NO
 *  `target` — the key IS the site_content key — which is exactly why the built-in
 *  `fieldCurrentValue` (which reads field.target.store) cannot resolve them. */
const CUSTOM_MANIFEST = {
  template: 'skeen',
  fields: [
    { key: 'hero_caption', label: 'Hero caption', type: 'text', defaultValue: 'Backstage' },
    { key: 'about_copy', label: 'About copy', type: 'text' },
    { key: 'press_email', label: 'Press email', type: 'email' },
    // An image field must NOT become a text box; skeen edits images via slots.
    { key: 'polaroid_1_photo', label: 'Polaroid 1', type: 'image' },
  ],
  slots: [],
  styles: [],
  links: [],
} as unknown as TemplateManifest

/** A minimal draft — this file only needs one to hand the frame; the payload's WIRE
 *  SHAPE is pinned in tests/editor-custom-frame.test.tsx, so it is cast rather than
 *  re-listed field-for-field as that contract grows. */
const draft = {
  artist: {
    id: 'a1', slug: 'skeen', name: 'Skeen', bio: null,
    hero_image_url: null, template: 'custom', spotify_artist_id: null,
  },
  tracks: [], tour_dates: [], merch: [], links: [], videos: [],
  media: [],
  site_content: { hero_caption: '/ backstage /' },
  styles: {},
  fonts: [],
  font_slots: {},
} as unknown as PublicSitePayload

function renderShell(opts: {
  /** The artist's external site origin. Set = a CUSTOM site, whose frame is the only
   *  place its editable fields are declared. */
  customSiteUrl?: string | null
  textFields?: EditorTextField[]
  siteContent?: Record<string, string>
  draft?: PublicSitePayload | null
}) {
  return render(
    <EditorShell
      artistId="artist-1"
      customSiteUrl={opts.customSiteUrl ?? null}
      draft={opts.draft ?? null}
      photos={[]}
      imageFields={[]}
      textFields={opts.textFields ?? []}
      siteContent={opts.siteContent ?? {}}
      links={[]}
      supportLinks={[]}
      linkValues={{}}
      videos={[]}
      merch={[]}
      releases={[]}
      tours={[]}
    />,
  )
}

/** Simulate the frame announcing itself from `origin`, carrying its manifest. */
function frameSays(msg: Record<string, unknown>, origin: string) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', { data: { v: BRIDGE_VERSION, source: FRAME_SOURCE, ...msg }, origin }),
    )
  })
}

afterEach(cleanup)

describe('runtimeTextFields — deriving Text controls from a BRIDGED manifest', () => {
  it('takes the value from the draft site_content, keyed by the field key itself', () => {
    const fields = runtimeTextFields(CUSTOM_MANIFEST, { hero_caption: '/ backstage /' })
    expect(fields.find((f) => f.key === 'hero_caption')).toMatchObject({
      key: 'hero_caption',
      label: 'Hero caption',
      type: 'text',
      value: '/ backstage /',
    })
  })

  it("carries the site's declared default, so an unset field isn't shown as Empty", () => {
    // A custom site keeps its fallbacks in code — the page shows real words while the row
    // does not exist. Sam opened the Text panel and every one of these read "Empty", which
    // is true of the database and useless to someone looking at the page. The manifest now
    // declares what the site renders and the panel shows that instead.
    const fields = runtimeTextFields(CUSTOM_MANIFEST, {})
    expect(fields.find((f) => f.key === 'hero_caption')!.defaultValue).toBe('Backstage')
    // A field whose manifest declares none is still undefined, not the empty string — the
    // panel falls through to "Empty" for it, which is then the honest answer.
    expect(fields.find((f) => f.key === 'about_copy')!.defaultValue).toBeUndefined()
  })

  it("prefers the manager's stored value over the declared default", () => {
    const fields = runtimeTextFields(CUSTOM_MANIFEST, { hero_caption: 'Typed by the manager' })
    const f = fields.find((x) => x.key === 'hero_caption')!
    expect(f.value).toBe('Typed by the manager')
    expect(f.defaultValue).toBe('Backstage')
  })

  it('renders an unset key as an empty control, not "undefined"', () => {
    const fields = runtimeTextFields(CUSTOM_MANIFEST, {})
    expect(fields.find((f) => f.key === 'hero_caption')!.value).toBe('')
  })

  it('offers text and email fields ONLY — an image field is edited as an image', () => {
    const keys = runtimeTextFields(CUSTOM_MANIFEST, {}).map((f) => f.key)
    expect(keys).toEqual(['hero_caption', 'about_copy', 'press_email'])
  })

  it('gives *_copy a multiline control (same rule the built-in path uses)', () => {
    const fields = runtimeTextFields(CUSTOM_MANIFEST, {})
    expect(fields.find((f) => f.key === 'about_copy')!.multiline).toBe(true)
    expect(fields.find((f) => f.key === 'hero_caption')!.multiline).toBe(false)
  })

  it('tolerates a frame that declares no fields at all (older skeen builds send only styles)', () => {
    expect(runtimeTextFields({ styles: [] } as unknown as TemplateManifest, {})).toEqual([])
    expect(runtimeTextFields(null, {})).toEqual([])
  })
})

describe('EditorShell — Text panel on a CUSTOM site', () => {
  it('shows the frame manifest\'s text fields with their current draft values', () => {
    renderShell({ customSiteUrl: CUSTOM, draft, siteContent: draft.site_content })
    // Before the frame answers there is nothing to show — the manifest is the source.
    frameSays({ type: 'ready', manifest: CUSTOM_MANIFEST }, CUSTOM)

    fireEvent.click(screen.getByRole('button', { name: /Text/ }))
    // The list is READ-ONLY now: the copy is shown, and Edit opens it full-panel.
    expect(screen.getByText('/ backstage /')).toBeTruthy()
    expect(screen.getByLabelText('Edit Press email')).toBeTruthy()
    // The image field stayed out of the Text panel.
    expect(screen.queryByLabelText('Polaroid 1')).toBeNull()
  })

  it('counts them on the browse list, so Text does not read "0 fields"', () => {
    renderShell({ customSiteUrl: CUSTOM, draft, siteContent: draft.site_content })
    frameSays({ type: 'ready', manifest: CUSTOM_MANIFEST }, CUSTOM)
    expect(screen.getByRole('button', { name: /Text/ }).textContent).toContain('3 fields')
  })

  it("REPLACES any built-in fields the server resolved from the artist's template column", () => {
    // The shipped bug: skeen is site_kind='custom' but template='cinematic', so the
    // server happily resolved CINEMATIC's fields ('Hero tagline' …) and the panel looked
    // populated — with controls for a site nobody was editing, while skeen's own captions
    // had none. The frame's manifest is the only truth about a custom site.
    const cinematic: EditorTextField[] = [
      { key: 'hero_tagline', label: 'Hero tagline', type: 'text', value: 'DJ & Producer', multiline: false },
    ]
    renderShell({ customSiteUrl: CUSTOM, draft, siteContent: draft.site_content, textFields: cinematic })
    frameSays({ type: 'ready', manifest: CUSTOM_MANIFEST }, CUSTOM)

    fireEvent.click(screen.getByRole('button', { name: /Text/ }))
    expect(screen.getByLabelText('Edit Hero caption')).toBeTruthy()
    expect(screen.queryByLabelText('Hero tagline')).toBeNull()
  })

  it('ignores a manifest posted from a foreign origin', () => {
    // Origin discipline: a stranger must not be able to inject editable fields.
    renderShell({ customSiteUrl: CUSTOM, draft, siteContent: draft.site_content })
    frameSays({ type: 'ready', manifest: CUSTOM_MANIFEST }, 'https://evil.example')
    expect(screen.getByRole('button', { name: /Text/ }).textContent).toContain('0 fields')
  })
})

describe('EditorShell — a BUILT-IN template is unchanged', () => {
  const SERVER_FIELDS: EditorTextField[] = [
    { key: 'hero_tagline', label: 'Hero tagline', type: 'text', value: 'DJ & Producer', multiline: false },
  ]

  it('renders the server-resolved fields (page.tsx resolved them from the local manifest)', () => {
    renderShell({ customSiteUrl: null, textFields: SERVER_FIELDS })
    fireEvent.click(screen.getByRole('button', { name: /Text/ }))
    expect(screen.getByText('DJ & Producer')).toBeTruthy()
  })

  it('is NOT hijacked by a manifest arriving over the bridge', () => {
    // A built-in frame declares nothing today, but if it ever did, the server-resolved
    // fields (which carry real targets and real values) must still win.
    renderShell({ customSiteUrl: null, textFields: SERVER_FIELDS })
    frameSays({ type: 'ready', manifest: CUSTOM_MANIFEST }, window.location.origin)
    fireEvent.click(screen.getByRole('button', { name: /Text/ }))
    expect(screen.getByLabelText('Edit Hero tagline')).toBeTruthy()
    expect(screen.queryByLabelText('Hero caption')).toBeNull()
  })
})
