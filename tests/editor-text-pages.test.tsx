// @vitest-environment jsdom
/**
 * THE TEXT PANEL LISTS EVERY PAGE'S COPY, AND CLICKING A ROW GOES THERE.
 *
 * Sam, 2026-09-09, rejecting the page-tab design that shipped earlier that day: "I dont
 * want tabs to move between screens. There should be a slot in the text page that says
 * about and below that should have the about text. Clicking it should highlight the about
 * text on the about page."
 *
 * So the panel does NOT filter to the page in the frame. It shows everything, with a
 * heading for the copy that lives elsewhere, and the click is the navigation: the frame
 * is asked to move, and the outline lands once it arrives (the holding is pinned in
 * tests/use-frame-bridge.test.tsx).
 *
 * The reason this can work at all is that skeen declares its fields STATICALLY, so every
 * page's announce carries every page's copy. A DOM-derived field would only appear after
 * the frame had already been to that page — which is precisely what tabs were papering
 * over, and why they had to go rather than be restyled.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { TextTools } from '@/app/artists/[id]/(dashboard)/editor/panels/text-tools'
import { runtimeTextFields } from '@/app/artists/[id]/(dashboard)/editor/editor-shell'
import type { EditorTextField } from '@/app/artists/[id]/(dashboard)/editor/inspector-types'
import type { TemplateManifest } from '@/lib/site-editor/manifest'
import type { PublicSitePayload } from '@/lib/site'
import type { SelectTarget } from '@samfox1/site-bridge/protocol'

// The inspector reaches for the app router (useSessionRevert) and the dashboard's server
// actions. Neither is what this suite is about; both must exist for it to render.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/app/artists/[id]/(dashboard)/actions', () => import('./helpers/editor-actions'))

afterEach(cleanup)

const PAGES = [
  { key: 'home', label: 'Home', path: '/' },
  { key: 'about', label: 'About', path: '/about' },
]

const manifest = {
  template: 'skeen',
  pages: PAGES,
  styles: [],
  fields: [
    { key: 'hero_tagline', label: 'Tagline', type: 'text', target: { store: 'site_content', key: 'hero_tagline' } },
    { key: 'hero_note', label: 'Note', type: 'text', target: { store: 'site_content', key: 'hero_note' } },
    // Declared on About, targeting the artist's bio column — the copy Sam wants a slot for.
    { key: 'artist_bio', label: 'About', type: 'text', target: { store: 'artist', column: 'bio' }, page: 'about' },
  ],
} as unknown as TemplateManifest

const draft = { artist: { bio: 'skeen is a band from texas.' } } as unknown as PublicSitePayload

describe('a field declared on another page keeps its page, and its page’s name', () => {
  it('CRITICAL: the About field arrives with the page and the label to head it with', () => {
    const fields = runtimeTextFields(manifest, {}, draft)
    const bio = fields.find((f) => f.key === 'artist_bio')
    expect(bio, 'the About field never reached the Text panel').toBeDefined()
    expect(bio?.page).toBe('about')
    expect(bio?.pageLabel, 'the heading comes from the site’s own page label').toBe('About')
    expect(bio?.value).toBe('skeen is a band from texas.')
  })

  it('CRITICAL: the FIRST page’s fields carry no heading — Home looks as it always did', () => {
    // Untagged means the first declared page (the bridge's rule). Heading those would put
    // a "Home" bar above every existing site's Text panel for no information.
    const fields = runtimeTextFields(manifest, {}, draft)
    const hero = fields.find((f) => f.key === 'hero_tagline')
    expect(hero?.pageLabel).toBeUndefined()
  })

  it('CRITICAL: a field tagged with the first page explicitly is still not headed', () => {
    // Otherwise a site that tags everything gets a "Home" heading and a changed panel for
    // saying out loud what it already meant.
    const tagged = {
      ...manifest,
      fields: [{ key: 'hero_tagline', label: 'Tagline', type: 'text', target: { store: 'site_content', key: 'hero_tagline' }, page: 'home' }],
    } as unknown as TemplateManifest
    expect(runtimeTextFields(tagged, {}, draft)[0]?.pageLabel).toBeUndefined()
  })

  it('CRITICAL: a field tagged with an UNDECLARED page belongs to the FIRST page, not to nowhere', () => {
    // Review, 2026-09-09. `page` used to be the RAW tag: a field tagged `shop_2019` on a
    // site that no longer declares that page was headed under nothing (correct) but its
    // highlight still named `shop_2019` — and the hook holds a highlight until the frame
    // reports reaching that page, which it never will. The row did nothing. Items already
    // followed the fold's rule (degrade to misplaced, never to invisible); fields now do too.
    const stale = {
      ...manifest,
      fields: [{ key: 'ghost', label: 'Ghost', type: 'text', target: { store: 'site_content', key: 'ghost' }, page: 'shop_2019' }],
    } as unknown as TemplateManifest
    const [ghost] = runtimeTextFields(stale, {}, draft)
    expect(ghost?.page, 'the raw tag leaked through — this highlight would stall').toBe('home')
    expect(ghost?.pageLabel).toBeUndefined()
  })

  it('a site that declares no pages heads nothing, whatever its fields say', () => {
    const nopages = { ...manifest, pages: undefined } as unknown as TemplateManifest
    for (const f of runtimeTextFields(nopages, {}, draft)) expect(f.pageLabel).toBeUndefined()
  })
})

const field = (over: Partial<EditorTextField>): EditorTextField => ({
  key: 'k', label: 'L', type: 'text', value: 'v', multiline: false, ...over,
})

describe('the panel puts other pages under their own heading', () => {
  const fields = [
    field({ key: 'hero_tagline', label: 'Tagline', value: 'songs from the flood' }),
    field({ key: 'artist_bio', label: 'About', value: 'skeen is a band', page: 'about', pageLabel: 'About' }),
  ]

  it('CRITICAL: the About heading is rendered, and its row sits under it', () => {
    // The GROUP HEADING specifically, not just the text "About" — the row's own label is
    // also "About", so `getByText` alone passes whether or not a heading exists. The
    // heading is the eyebrow `<span>` GroupLabel renders inside its flex bar.
    const { container } = render(
      <TextTools textFields={fields} values={{ artist_bio: 'skeen is a band' }} status="idle" />,
    )
    const headings = [...container.querySelectorAll('div.flex.items-center.gap-2 > span:first-child')].map(
      (el) => el.textContent,
    )
    expect(headings, 'no group heading was rendered for the About page').toContain('About')
    expect(screen.getByText('skeen is a band')).toBeTruthy()
    // And the row is UNDER it, not above: order is what makes it read as a section.
    const text = container.textContent ?? ''
    expect(text.indexOf('About')).toBeLessThan(text.indexOf('skeen is a band'))
  })

  it('CRITICAL: a single-page site renders NO page heading at all', () => {
    // Every site but skeen. A heading appearing here would be a visible regression on
    // sites that have nothing to do with pages.
    const { container } = render(
      <TextTools textFields={[field({ key: 'hero_tagline', label: 'Tagline', value: 'x' })]} values={{}} status="idle" />,
    )
    expect(container.textContent).not.toContain('Home')
    expect(container.textContent).toContain('Tagline')
  })

  it('CRITICAL: clicking the About row asks to edit it, carrying the page', () => {
    // The row is the navigation. `onEditField` gets the field, whose `page` is what the
    // inspector turns into a cross-page highlight.
    const onEditField = vi.fn()
    render(<TextTools textFields={fields} values={{}} status="idle" onEditField={onEditField} />)
    fireEvent.click(screen.getByRole('button', { name: /About/ }))
    expect(onEditField).toHaveBeenCalledTimes(1)
    expect(onEditField.mock.calls[0][0]).toMatchObject({ key: 'artist_bio', page: 'about' })
  })
})

/* ── the click is the navigation ───────────────────────────────────────────────────── */
import { EditorInspector } from '@/app/artists/[id]/(dashboard)/editor/editor-inspector'

describe('opening a row for another page tells the frame which page it is on', () => {
  const textFields = [
    field({ key: 'hero_tagline', label: 'Tagline', value: 'songs from the flood' }),
    field({ key: 'artist_bio', label: 'About', value: 'skeen is a band', page: 'about', pageLabel: 'About' }),
  ]

  const open = (onHighlight: (target: SelectTarget, page?: string) => void) => {
    render(<EditorInspector artistId="a1" photos={[]} textFields={textFields} onHighlight={onHighlight} />)
    fireEvent.click(screen.getByRole('button', { name: 'Text' }))
  }

  it('CRITICAL: the About row highlights WITH its page — the frame has to travel', () => {
    // Without the page the editor posts a highlight for an element on a page the frame is
    // not showing: nothing outlines, and the row looks broken. The holding and firing is
    // the hook's job (tests/use-frame-bridge.test.tsx); this pins that the page is passed
    // at all, which is the half that lives in the panel.
    const onHighlight = vi.fn()
    open(onHighlight)
    fireEvent.click(screen.getByRole('button', { name: /Edit About/ }))

    expect(onHighlight).toHaveBeenCalled()
    const [target, page] = onHighlight.mock.calls.at(-1)!
    expect(target).toMatchObject({ kind: 'field', key: 'artist_bio' })
    expect(page, 'the page never reached the frame').toBe('about')
  })

  it('CRITICAL: a row on the page already showing passes NO page', () => {
    // The other half, and the one that would be vacuous alone: passing every row's page
    // (or a constant) would satisfy the test above without distinguishing anything.
    const onHighlight = vi.fn()
    open(onHighlight)
    fireEvent.click(screen.getByRole('button', { name: /Edit Tagline/ }))

    const call = onHighlight.mock.calls.at(-1)!
    expect(call[0]).toMatchObject({ kind: 'field', key: 'hero_tagline' })
    // Arity, not a destructured `undefined` — a trailing explicit undefined would pass
    // the destructured form and still break every one-argument caller's tests.
    expect(call.length, 'a page argument was passed for a first-page field').toBe(1)
  })
})

/* ── an ITEM on another page travels too (P4) ───────────────────────────────────────── */
import type { EditorMerch } from '@/app/artists/[id]/(dashboard)/editor/inspector-types'

describe('selecting a merch card tells the frame which page merch lives on', () => {
  const merch: EditorMerch[] = [
    { id: 'p1', title: 'Tour Tee', price: '30', url: '', image_url: null, onSite: true, inStock: true, fromShopify: false },
  ]
  const openMerch = (onHighlight: (t: SelectTarget, page?: string) => void, itemPages?: Record<string, string>) => {
    render(<EditorInspector artistId="a1" photos={[]} merch={merch} itemPages={itemPages} onHighlight={onHighlight} />)
    fireEvent.click(screen.getByRole('button', { name: 'Merch' }))
    fireEvent.click(screen.getByRole('button', { name: 'Select Tour Tee' }))
  }

  it('CRITICAL: with the merch slot tagged, the highlight names its page', () => {
    // Without this the card click posts a highlight for `merch:p1` while the frame shows
    // home — the region is in no frame the editor has loaded, and nothing outlines. This
    // is the round trip the plan said P4 would close.
    const onHighlight = vi.fn()
    openMerch(onHighlight, { merch: 'merch' })
    const [target, page] = onHighlight.mock.calls.at(-1)!
    expect(target).toMatchObject({ kind: 'item', assetType: 'merch', id: 'p1' })
    expect(page).toBe('merch')
  })

  it('CRITICAL: with no page for the asset, the highlight carries none', () => {
    // Every single-page site. A trailing page here would make the hook hold the request
    // for a page-change that never comes.
    const onHighlight = vi.fn()
    openMerch(onHighlight, undefined)
    const call = onHighlight.mock.calls.at(-1)!
    expect(call[0]).toMatchObject({ kind: 'item', assetType: 'merch', id: 'p1' })
    expect(call.length, 'a page argument was passed for an item with no page').toBe(1)
  })
})
