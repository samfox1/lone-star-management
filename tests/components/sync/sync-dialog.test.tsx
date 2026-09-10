// @vitest-environment jsdom
/**
 * SYNC OPENS A DIALOG, IT DOES NOT NAVIGATE (Sam, 2026-09-09).
 *
 * "if the user clicks sync on the music tab, a modal or window or dialogue should appear
 * with all of the music integrations connected where the user can toggle if they want to
 * resync the content from those services. if the user is on merch, then the merch
 * integrations should appear. I dont want the sync button to redirect the user to the
 * integrations page. There can be a button on that pop up that says sync other platforms
 * that then leads the user to the itegrations page."
 *
 * What it replaced: on Merch, Sync was a LINK to /tools/integrations — a manager who
 * wanted their products refreshed was sent to a settings page to find a button. On Music
 * it pulled every connected source at once with no say in which.
 *
 * The sources come from the page, which resolves them server-side (an id column for the
 * platform integrations, Vault for Shopify). This component is the choosing and the
 * reporting: it never decides who is connected.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { SyncDialog, type SyncRunResult, type SyncSource } from '@/app/artists/[id]/(dashboard)/sync-dialog'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

afterEach(cleanup)

const src = (over: Partial<SyncSource>): SyncSource => ({
  key: 'spotify', label: 'Spotify', connected: true, ...over,
})

type Run = (artistId: string, section: string, keys: string[]) => Promise<{ results: SyncRunResult[] }>
const noResults: Run = async () => ({ results: [] })

const open = (sources: SyncSource[], run: Run = noResults) => {
  const r = render(
    <SyncDialog artistId="a1" section="music" sources={sources} run={run} integrationsHref="/artists/a1/tools/integrations" />,
  )
  fireEvent.click(screen.getByRole('button', { name: /^sync$/i }))
  return { ...r, run }
}

describe('the dialog lists the sources for THIS section', () => {
  it('CRITICAL: it opens in place — no navigation', () => {
    // The report, stated as the absence of the old behaviour: the trigger must be a
    // button, not a link to the integrations page.
    open([src({})])
    expect(screen.getByRole('dialog')).toBeTruthy()
    const trigger = screen.getByRole('button', { name: /^sync$/i })
    expect(trigger.tagName, 'Sync is still a link').toBe('BUTTON')
  })

  it('CRITICAL: a connected source is listed and CHECKED by default', () => {
    // The common press is "refresh everything I have connected", so the dialog opens
    // ready for it. Toggling is the exception, not the ritual.
    open([src({ key: 'spotify', label: 'Spotify' }), src({ key: 'apple', label: 'Apple Music' })])
    for (const label of ['Spotify', 'Apple Music']) {
      expect(within(screen.getByRole('dialog')).getByRole('checkbox', { name: label })).toBeChecked()
    }
  })

  it('CRITICAL: a DISCONNECTED source is not listed at all', () => {
    // It used to be named with a "NOT CONNECTED" tag beside it. Sam, 2026-09-09, on a
    // screenshot of exactly that: "if shopify, or any service, is not connected, it
    // shouldn't say one isnt connected". A row a manager cannot act on is noise in a
    // dialog whose whole job is choosing what to run — the way to a service you have not
    // connected is "Sync other platforms", which is on screen.
    open([src({ key: 'spotify' }), src({ key: 'deezer', label: 'Deezer', connected: false })])
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.queryByText('Deezer'), 'a disconnected service is still listed').toBeNull()
    expect(dialog.queryByText(/not connected/i)).toBeNull()
    // The witness: the connected one IS there, so this is a filter and not an empty box.
    expect(dialog.getByRole('checkbox', { name: 'Spotify' })).toBeTruthy()
  })

  it('CRITICAL: only the TICKED sources are synced', () => {
    const run = vi.fn(noResults)
    open([src({ key: 'spotify', label: 'Spotify' }), src({ key: 'apple', label: 'Apple Music' })], run)
    const dialog = within(screen.getByRole('dialog'))
    fireEvent.click(dialog.getByRole('checkbox', { name: 'Apple Music' })) // untick
    fireEvent.click(dialog.getByRole('button', { name: /sync now/i }))
    expect(run).toHaveBeenCalledWith('a1', 'music', ['spotify'])
  })

  it('CRITICAL: with nothing ticked, Sync now is not available', () => {
    // A press that provably does nothing is worse than a disabled control.
    open([src({ key: 'spotify', label: 'Spotify' })])
    const dialog = within(screen.getByRole('dialog'))
    fireEvent.click(dialog.getByRole('checkbox', { name: 'Spotify' }))
    expect(dialog.getByRole('button', { name: /sync now/i })).toBeDisabled()
  })

  it('CRITICAL: "Sync other platforms" is the ONLY route to the integrations page', () => {
    // Sam's own compromise: the link stays, as a link, out of the way of the press
    // everyone actually came for.
    open([src({})])
    const link = within(screen.getByRole('dialog')).getByRole('link', { name: /other platforms/i })
    expect(link.getAttribute('href')).toBe('/artists/a1/tools/integrations')
  })
})

describe('the dialog reports what each source did', () => {
  it('CRITICAL: a per-source result is shown, success and failure side by side', () => {
    // The point of doing this per source rather than as one button: a run where Spotify
    // worked and Apple did not used to collapse into one joined error string.
    const run = vi.fn<Run>(async () => ({
      results: [
        { key: 'spotify', label: 'Spotify', ok: true, message: '4 added, 2 updated' },
        { key: 'apple', label: 'Apple Music', ok: false, error: 'No Apple Music artist linked yet.' },
      ],
    }))
    open([src({ key: 'spotify', label: 'Spotify' }), src({ key: 'apple', label: 'Apple Music' })], run)
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /sync now/i }))
    return vi.waitFor(() => {
      const dialog = within(screen.getByRole('dialog'))
      expect(dialog.getByText('4 added, 2 updated')).toBeTruthy()
      expect(dialog.getByText('No Apple Music artist linked yet.')).toBeTruthy()
    })
  })

})

describe('a section with NOTHING connected offers a way in, not a dead button', () => {
  it('CRITICAL: it names what KIND of service is missing, and offers to connect one', () => {
    // Sam, 2026-09-09: "it should say no merchandise service integrations. and then have
    // the button to connect more." The screenshot that prompted it showed "Shopify NOT
    // CONNECTED" beside a greyed-out SYNC NOW — a dialog that told a manager about a
    // thing they do not have and then refused to do anything.
    render(
      <SyncDialog artistId="a1" section="merch" sources={[src({ key: 'shopify', label: 'Shopify', connected: false })]} run={noResults} integrationsHref="/artists/a1/tools/integrations" />,
    )
    fireEvent.click(screen.getByRole('button', { name: /^sync$/i }))
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByText(/no merchandise service integrations/i)).toBeTruthy()
    expect(dialog.getByRole('link', { name: /connect/i }).getAttribute('href')).toBe('/artists/a1/tools/integrations')
  })

  it('CRITICAL: there is no Sync now to press', () => {
    // A control that provably cannot work is worse than no control — it reads as the
    // dialog being broken rather than the store being unconnected.
    render(
      <SyncDialog artistId="a1" section="merch" sources={[src({ connected: false })]} run={noResults} integrationsHref="/x" />,
    )
    fireEvent.click(screen.getByRole('button', { name: /^sync$/i }))
    expect(within(screen.getByRole('dialog')).queryByRole('button', { name: /sync now/i })).toBeNull()
  })

  it('CRITICAL: each section names its OWN kind of service', () => {
    // "No music service integrations" on the Merch page would be worse than the bug.
    for (const [section, noun] of [['music', /music service/i], ['videos', /video service/i], ['tour', /tour date service/i]] as const) {
      render(
        <SyncDialog artistId="a1" section={section} sources={[src({ connected: false })]} run={noResults} integrationsHref="/x" />,
      )
      fireEvent.click(screen.getByRole('button', { name: /^sync$/i }))
      expect(within(screen.getByRole('dialog')).getByText(noun), section).toBeTruthy()
      cleanup()
    }
  })

  it('a section with no sources at all says the same thing', () => {
    // Belt: `sourcesForSection` always returns something today, but an empty list must
    // not fall through to a blank card.
    open([])
    expect(within(screen.getByRole('dialog')).getByText(/integrations/i)).toBeTruthy()
  })
})
