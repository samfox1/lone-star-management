// @vitest-environment jsdom
// The (Mobile) tag reaches the panels a manager actually opens, not just the control objects.
/**
 * THE (Mobile) TAG REACHES THE PANELS A MANAGER ACTUALLY OPENS.
 *
 * Sam's screenshot (2026-08-17): the text-field editor in phone view, no mobile
 * anything. The tags had been wired into ControlRow and unit-tested on the CONTROL
 * objects, but nothing rendered the real editors to prove the flag survives the
 * prop path — styleOptions → editor → builder → row. These do.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { TextFieldEditor } from '@/app/artists/[id]/(dashboard)/editor/text-field-editor'
import { ItemEditor } from '@/app/artists/[id]/(dashboard)/editor/item-editor'
import { withStyleVars, type EditorStyleOptions } from '@/lib/site-editor/style-controls'

vi.mock('@/app/artists/[id]/(dashboard)/actions', () => ({
  saveEditorFieldAction: vi.fn(async () => ({ ok: true })),
  saveEditorStyleAction: vi.fn(async () => ({ ok: true })),
}))
vi.mock('@/app/artists/[id]/(dashboard)/media-uploader', () => ({
  MediaUploader: () => null,
  GallerySlotUploader: () => null,
}))

afterEach(cleanup)

const PHONE: EditorStyleOptions = { ...withStyleVars({ fonts: [] }, '0.23.0'), mobileView: true }
const DESKTOP: EditorStyleOptions = withStyleVars({ fonts: [] }, '0.23.0')

const FIELD = {
  key: 'tour_heading', label: 'Tour', type: 'text' as const, value: 'Tour',
  multiline: false, styleRegion: { key: 'tour_heading', label: 'Tour heading' },
}

describe('TextFieldEditor', () => {
  const mount = (opts: EditorStyleOptions) =>
    render(
      <TextFieldEditor
        field={FIELD} value="Tour" status="idle" styleValues={{}}
        styleOptions={opts} onEdit={() => {}} onStyle={() => {}} onBack={() => {}}
      />,
    )

  it('phone view: Size row carries a bold (Mobile) tag', () => {
    mount(PHONE)
    const tags = screen.getAllByText('(Mobile)')
    expect(tags.length).toBeGreaterThanOrEqual(4) // size, thickness, leading, tracking
    expect(tags[0].tagName).toBe('B')
  })

  it('desktop view: no tag anywhere', () => {
    mount(DESKTOP)
    expect(screen.queryByText('(Mobile)')).toBeNull()
  })
})

describe('ItemEditor (the hero-logo case)', () => {
  const mount = (opts: EditorStyleOptions) =>
    render(
      <ItemEditor
        artistId="artist-1"
        styleKey="slot:hero_wordmark_1_image" label="Hero logo" initialClasses="opacity-30"
        preview={<span />} replace={{ title: 'Replace', candidates: [], onPick: () => {} }} palette={opts}
        onRemove={() => {}} onApplyStyle={() => {}} onBack={() => {}}
      />,
    )

  it('phone view: the Size (scale) row is tagged', () => {
    mount(PHONE)
    expect(screen.getAllByText('(Mobile)').length).toBeGreaterThanOrEqual(1)
  })

  it('desktop view: untagged', () => {
    mount(DESKTOP)
    expect(screen.queryByText('(Mobile)')).toBeNull()
  })
})
