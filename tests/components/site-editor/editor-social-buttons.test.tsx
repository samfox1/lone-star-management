// @vitest-environment jsdom
// Editor → Socials: the site's BUTTONS, each made from a connection; Add button picks one, never types a URL.
/**
 * Sam, 2026-09-28: "when the connection is added, and I travel to the socials list in the
 * site editor, I can add a new button based on one of the existing connections that I
 * have. That is how the flow should work, and it should reference the link provided by
 * the connection." Asked where a button is switched on and off: "Only in the editor."
 * And Shopify and the other services are not social buttons.
 *
 * What has to hold:
 *   - the list is the ON-SITE social links only, each as mark · name · handle, with no URL
 *     box: the link is edited in Connections, and the button IS that link;
 *   - "Add button" opens a picker of the connections with a profile link that are not
 *     buttons yet — never a service, never a contact or role-bound row;
 *   - picking turns THAT row on (the live toggle, for its id) — no new row, nothing typed;
 *   - taking a button off sets on_site false and deletes nothing: the connection stays;
 *   - with nothing left to pick, one line and a way to connect an account WITHOUT leaving
 *     the editor; what is connected there is pickable as soon as the page refreshes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { socialIcon } from '@samfox1/site-bridge/social-icons'
import { EditorInspector } from '@/app/artists/[id]/(dashboard)/editor/editor-inspector'
import type { EditorLink } from '@/app/artists/[id]/(dashboard)/editor/inspector-types'
import {
  addContentAction,
  deleteContentAction,
  reorderContentAction,
  setOnSiteAction,
  updateContentAction,
} from '@/app/artists/[id]/(dashboard)/actions'
import { connectOneAction } from '@/app/artists/[id]/(dashboard)/(manager-tools)/connections/actions'
import { CONNECTIONS } from '@/lib/connections'

const refresh = vi.hoisted(() => vi.fn())
vi.mock('@/app/artists/[id]/(dashboard)/actions', () => import('@tests/helpers/editor-actions'))
vi.mock('@/app/artists/[id]/(dashboard)/(manager-tools)/connections/actions', () => import('@tests/helpers/connections-actions'))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

/** Every service, derived: none may ever be offered as a button (AGENTS.md rule 4). */
const SERVICES = CONNECTIONS.filter((d) => d.kind === 'service')
const SOCIALS = CONNECTIONS.filter((d) => d.social)

const LINKS: EditorLink[] = [
  { id: 'l-sp', label: 'Spotify', url: 'https://open.spotify.com/artist/26K', onSite: true },
  { id: 'l-x', label: 'X', url: 'https://x.com/skeenmusic', onSite: true },
  { id: 'l-tt', label: 'TikTok', url: 'https://tiktok.com/@skeen', onSite: false },
  { id: 'l-ig', label: 'Instagram', url: 'https://instagram.com/skeen', onSite: false },
  // A row named for a service can only be planted, never made — which is the point: the
  // picker must refuse it on the rule, not on the rows it happens to be shown.
  ...SERVICES.map((d): EditorLink => ({ id: `l-${d.key}`, label: d.label, url: `https://example.com/${d.key}`, onSite: false })),
  { id: 'l-bk', label: 'Bookings', url: 'mailto:book@example.com', onSite: false },
]
const ALL_ON: EditorLink[] = LINKS.filter((l) => l.id === 'l-sp' || l.id === 'l-x')

function inspector(links: EditorLink[] = LINKS) {
  return (
    <EditorInspector
      artistId="artist-1"
      photos={[]}
      imageFields={[]}
      selectedRegion={null}
      textFields={[]}
      links={links}
      supportLinks={[]}
      linkValues={{}}
      videos={[]}
      videoSlots={[]}
      merch={[]}
      releases={[]}
      tours={[]}
      components={[]}
      imageCollections={[]}
      styleRegions={[]}
      styleValues={{}}
      selectedStyle={null}
      linkRegions={[]}
      selectedLink={null}
    />
  )
}
function openLinks(links: EditorLink[] = LINKS) {
  const view = render(inspector(links))
  fireEvent.click(screen.getByRole('button', { name: /Links/ }))
  return view
}
/** The buttons list: the Socials group's draggable rows. */
const buttonRows = () => [...document.querySelectorAll<HTMLElement>('[data-social-button]')]
const buttonNames = () => buttonRows().map((r) => r.getAttribute('data-social-button'))
function openPicker() {
  fireEvent.click(screen.getByRole('button', { name: 'Add button' }))
  return screen.getByRole('dialog', { name: 'Add button' })
}
/** The picker's cards, by the platform each names. */
const cardNames = (dialog: HTMLElement) =>
  within(dialog)
    .queryAllByRole('button')
    .map((b) => b.getAttribute('data-connection'))
    .filter(Boolean)

describe('Socials — the buttons on the site', () => {
  it('CRITICAL: lists only the on-site social links, each as its mark, name and handle — no URL box', () => {
    openLinks()
    expect(buttonNames()).toEqual(['Spotify', 'X'])
    const x = buttonRows()[1]
    expect(x).toHaveTextContent('X')
    expect(x).toHaveTextContent('skeenmusic') // the handle, not the link
    expect(x).not.toHaveTextContent('https://')
    // The connection's own mark (ConnectionMark), not a generic glyph.
    expect(x.querySelector(`svg path[d="${socialIcon('x')!.path}"]`)).not.toBeNull()
    // A link platform has no handle: its address, as a person says it.
    expect(buttonRows()[0]).toHaveTextContent('open.spotify.com/artist/26K')
    // Nothing here edits the link: that is Connections' job, and the button IS that link.
    for (const r of buttonRows()) {
      expect(within(r).queryAllByRole('textbox')).toHaveLength(0)
      expect(within(r).queryByRole('button', { name: /^Edit/ })).toBeNull()
    }
    expect(screen.queryByRole('button', { name: /Add social/ })).toBeNull()
  })

  it('CRITICAL: taking a button off sets on_site false through the live toggle — the connection is not deleted', async () => {
    openLinks()
    fireEvent.click(within(buttonRows()[1]).getByRole('button', { name: 'Remove the X button' }))
    expect(setOnSiteAction).toHaveBeenCalledWith('link', 'l-x', 'artist-1', false)
    expect(deleteContentAction).not.toHaveBeenCalled()
    expect(buttonNames()).toEqual(['Spotify'])
    // …and it is a choice again.
    expect(cardNames(openPicker())).toContain('X')
  })

  it('drags to reorder, renumbering the WHOLE list so the links not shown keep their place', () => {
    openLinks()
    const [sp, x] = buttonRows()
    fireEvent.dragStart(sp)
    fireEvent.drop(x)
    const rest = LINKS.slice(2).map((l) => l.id)
    expect(reorderContentAction).toHaveBeenCalledWith('link', 'artist-1', ['l-x', 'l-sp', ...rest])
  })
})

describe('Add button — a picker of the artist’s connections', () => {
  it('stays IN the editor: a button, not a link out', () => {
    openLinks()
    const add = screen.getByRole('button', { name: 'Add button' })
    expect(add.getAttribute('href')).toBeNull()
    expect(screen.queryByRole('link', { name: /Add/ })).toBeNull()
  })

  it('CRITICAL: offers the connections with a profile that are not buttons yet — A to Z, with mark and handle', () => {
    openLinks()
    const dialog = openPicker()
    expect(cardNames(dialog)).toEqual(['Instagram', 'TikTok'])
    const ig = within(dialog).getByRole('button', { name: /Instagram/ })
    expect(ig).toHaveTextContent('skeen')
    expect(ig.querySelector(`svg path[d="${socialIcon('instagram')!.path}"]`)).not.toBeNull()
    // Nothing to type: the button is the connection's link.
    expect(within(dialog).queryAllByRole('textbox')).toHaveLength(0)
  })

  it('CRITICAL: never offers a service, a contact row or a link already on the site', () => {
    expect(SERVICES.length).toBeGreaterThan(0) // the rule has to be guarding something
    openLinks()
    const dialog = openPicker()
    const names = cardNames(dialog)
    for (const d of SERVICES) expect(names, d.label).not.toContain(d.label)
    for (const n of ['Spotify', 'X', 'Bookings']) expect(names).not.toContain(n)
  })

  it('CRITICAL: picking one turns THAT row on — no new row, nothing typed — and it joins the list', async () => {
    openLinks()
    const dialog = openPicker()
    fireEvent.click(within(dialog).getByRole('button', { name: /TikTok/ }))
    expect(setOnSiteAction).toHaveBeenCalledTimes(1)
    expect(setOnSiteAction).toHaveBeenCalledWith('link', 'l-tt', 'artist-1', true)
    expect(addContentAction).not.toHaveBeenCalled()
    expect(updateContentAction).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: 'Add button' })).toBeNull()
    expect(buttonNames()).toEqual(['Spotify', 'X', 'TikTok'])
  })
})

describe('Add button — nothing left to pick', () => {
  it('CRITICAL: says so in one line, and opens Connect in place — socials only, the connected ones marked', () => {
    openLinks(ALL_ON)
    const dialog = openPicker()
    expect(cardNames(dialog)).toEqual([])
    expect(within(dialog).getByText(/No connected accounts left to add/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Connect an account' }))
    const connect = screen.getByRole('dialog', { name: 'Connect' })
    // Every social, and nothing else: a service is not a button, so not here either. The
    // whole name (or it + " (connected)"): a prefix would find "YouTube Music" for YouTube.
    const card = (label: string) => new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( \\(connected\\))?$`)
    for (const d of SERVICES) expect(within(connect).queryByRole('button', { name: card(d.label) }), d.label).toBeNull()
    for (const d of SOCIALS) expect(within(connect).getByRole('button', { name: card(d.label) })).toBeInTheDocument()
    expect(within(connect).getByRole('button', { name: 'X (connected)' })).toBeDisabled()
    expect(within(connect).getByRole('button', { name: 'Instagram' })).toBeEnabled()
    // Still the editor: no navigation happened, the Links panel is right there.
    expect(screen.getByRole('button', { name: 'Add button' })).toBeInTheDocument()
  })

  it('CRITICAL: an account connected there is pickable as soon as the page refreshes', async () => {
    const view = openLinks(ALL_ON)
    fireEvent.click(within(openPicker()).getByRole('button', { name: 'Connect an account' }))
    const connect = screen.getByRole('dialog', { name: 'Connect' })
    fireEvent.click(within(connect).getByRole('button', { name: 'Instagram' }))
    fireEvent.click(within(connect).getByRole('button', { name: 'Continue' }))
    fireEvent.change(within(connect).getByLabelText('Instagram username'), { target: { value: 'skeen' } })
    await act(async () => {
      fireEvent.click(within(connect).getByRole('button', { name: 'Connect' }))
    })
    expect(connectOneAction).toHaveBeenCalledWith('artist-1', 'instagram', expect.objectContaining({ handle: 'skeen' }))
    fireEvent.click(within(connect).getByRole('button', { name: 'Save' }))
    expect(refresh).toHaveBeenCalled()
    // Back at the picker, and the refresh brings the new (off-site) link in.
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Add button' })).toBeInTheDocument())
    const made: EditorLink = { id: 'l-new', label: 'Instagram', url: 'https://instagram.com/skeen', onSite: false }
    view.rerender(inspector([...ALL_ON, made]))
    const dialog = screen.getByRole('dialog', { name: 'Add button' })
    expect(cardNames(dialog)).toEqual(['Instagram'])
    fireEvent.click(within(dialog).getByRole('button', { name: /Instagram/ }))
    expect(setOnSiteAction).toHaveBeenCalledWith('link', 'l-new', 'artist-1', true)
  })
})
