// @vitest-environment jsdom
// The Brand page feeds the site editor: its colours lead the swatches, its font titles name the fonts.
/**
 * THE EDITOR FEED IS WIRED, not just implemented (BRAND_PAGE_PLAN.md):
 *   - brand colours appear FIRST in the site editor's swatches, by name;
 *   - an added font slot's title is what the editor's font list shows for that font.
 *
 * Both are unit-tested where they are computed (mergeSwatches, withSlotTitles); this file
 * renders the REAL shell so that dropping either feed from editor-shell.tsx goes red. The
 * inspector is replaced by a trap that records the style options it is handed and draws
 * one real ColorPalette — the same component every swatch row in the editor is.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { EditorShell, withSlotTitles } from '@/app/artists/[id]/(dashboard)/editor/editor-shell'
import { ColorPalette } from '@/app/artists/[id]/(dashboard)/editor/color-picker'
import type { EditorStyleOptions } from '@/lib/site-editor/style-controls'
import { BRIDGE_VERSION, FRAME_SOURCE } from '@samfox1/site-bridge/protocol'

const seen: { styleOptions?: EditorStyleOptions }[] = []
vi.mock('@/app/artists/[id]/(dashboard)/editor/editor-inspector', () => ({
  EditorInspector: (props: { styleOptions?: EditorStyleOptions }) => {
    seen.push(props)
    return <ColorPalette label="Text color" aria="Hero Text color" value="" used={['#e5484d', '#0d0d0d']} onChange={() => {}} />
  },
}))
vi.mock('@/app/artists/[id]/(dashboard)/actions', () => ({}))
vi.mock('@/app/artists/[id]/(dashboard)/media-uploader', () => ({
  MediaUploader: () => null,
  GallerySlotUploader: () => null,
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.stubGlobal(
  'ResizeObserver',
  class { observe() {} unobserve() {} disconnect() {} },
)

afterEach(cleanup)

const CUSTOM = 'https://skeen-website.vercel.app'

function renderShell(extra: Partial<Parameters<typeof EditorShell>[0]> = {}) {
  seen.length = 0
  render(
    <EditorShell
      artistId="artist-1" customSiteUrl={CUSTOM} draft={null} photos={[]}
      imageFields={[]} textFields={[]} siteContent={{}} links={[]}
      supportLinks={[]} linkValues={{}} videos={[]} merch={[]} releases={[]} tours={[]}
      {...extra}
    />,
  )
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          v: BRIDGE_VERSION, source: FRAME_SOURCE, type: 'ready',
          manifest: {
            template: 'skeen', fields: [], slots: [], links: [],
            styles: [{ key: 'hero', label: 'Hero' }],
            styleOptions: { fonts: [{ value: 'font-momo', label: 'Momo' }] },
          },
        },
        origin: CUSTOM,
      }),
    )
  })
  return seen.at(-1)!.styleOptions as EditorStyleOptions
}

describe('withSlotTitles', () => {
  it('a font in a titled added slot takes the slot title; the rest keep their own label', () => {
    expect(
      withSlotTitles(
        [
          { family: 'lsf-archivo', label: 'Archivo' },
          { family: 'lsf-grotesk', label: 'Grotesk' },
        ],
        [{ family: 'lsf-archivo', title: 'Gig posters' }],
      ),
    ).toEqual([
      { family: 'lsf-archivo', label: 'Gig posters' },
      { family: 'lsf-grotesk', label: 'Grotesk' },
    ])
  })

  it('one font in two titled slots takes the FIRST slot\'s title; a blank title changes nothing', () => {
    expect(
      withSlotTitles(
        [{ family: 'f', label: 'Own' }],
        [
          { family: 'f', title: '  ' },
          { family: 'f', title: 'First' },
          { family: 'f', title: 'Second' },
        ],
      ),
    ).toEqual([{ family: 'f', label: 'First' }])
  })
})

describe('EditorShell feeds the Brand page into the editor', () => {
  it('CRITICAL: brand colours lead the editor swatches, by name, and a shared hex appears once', () => {
    renderShell({ brandColors: [{ name: 'Our black', hex: '#0d0d0d' }, { name: 'The red', hex: '#c63a2a' }] })
    fireEvent.click(screen.getByRole('button', { name: 'Hero Text color palette' }))
    const dialog = screen.getByRole('dialog', { name: 'Hero Text color palette' })
    const swatches = within(dialog)
      .getAllByRole('button', { name: /^Hero Text color / })
      .map((b) => b.getAttribute('aria-label'))
    expect(swatches).toEqual(['Hero Text color Our black', 'Hero Text color The red', 'Hero Text color #e5484d'])
  })

  it('no brand colours: the swatches are the site\'s own, as before', () => {
    renderShell()
    fireEvent.click(screen.getByRole('button', { name: 'Hero Text color palette' }))
    const dialog = screen.getByRole('dialog', { name: 'Hero Text color palette' })
    expect(
      within(dialog)
        .getAllByRole('button', { name: /^Hero Text color / })
        .map((b) => b.getAttribute('aria-label')),
    ).toEqual(['Hero Text color #e5484d', 'Hero Text color #0d0d0d'])
  })

  it('CRITICAL: an added font slot\'s title is what the font list shows for that font', () => {
    const opts = renderShell({
      uploadedFonts: [
        { family: 'lsf-archivo', label: 'Archivo' },
        { family: 'lsf-grotesk', label: 'Grotesk' },
      ],
      fontSlotTitles: [{ family: 'lsf-archivo', title: 'Gig posters' }],
    })
    // The witness: the manifest's own font reached the options, so the list is real.
    expect(opts.fonts?.map((f) => f.value)).toContain('font-momo')
    expect(opts.fonts?.find((f) => f.value === 'font-lsf-archivo')?.label).toBe('Gig posters')
    expect(opts.fonts?.find((f) => f.value === 'font-lsf-grotesk')?.label).toBe('Grotesk')
  })
})
