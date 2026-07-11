// @vitest-environment jsdom
/**
 * The visual editor's left inspector (phase 2 panel). Covers the two-state
 * navigation and the photo-collection tools' structure — Browse lists the
 * component types; opening Images shows the collection tools (grid, size slider,
 * accordions, switcher strip); Back returns; accordions collapse.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { EditorInspector } from '@/app/artists/[id]/(dashboard)/editor/editor-inspector'

afterEach(cleanup)

describe('EditorInspector — browse state', () => {
  it('lists every component type', () => {
    render(<EditorInspector />)
    for (const label of ['Images', 'Text', 'Links', 'Videos', 'Music', 'Merch']) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeTruthy()
    }
  })

  it('does not show editing tools until a component is opened', () => {
    render(<EditorInspector />)
    expect(screen.queryByText('Live Shots')).toBeNull()
    expect(screen.queryByLabelText('Collection size')).toBeNull()
  })
})

describe('EditorInspector — opening Images', () => {
  function openImages() {
    render(<EditorInspector />)
    fireEvent.click(screen.getByRole('button', { name: /Images/ }))
  }

  it('opens the photo-collection editing view', () => {
    openImages()
    expect(screen.getByText('Live Shots')).toBeTruthy()
    expect(screen.getByText('12 photos · Grid')).toBeTruthy()
  })

  it('shows the reorderable photo grid with add + remove affordances', () => {
    openImages()
    expect(screen.getByRole('button', { name: 'Remove backstage-03.jpg' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Add photos/ })).toBeTruthy()
  })

  it('shows the size slider and layout controls', () => {
    openImages()
    expect(screen.getByLabelText('Collection size')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'More columns' })).toBeTruthy()
  })

  it('collapses a section when its header is toggled', () => {
    openImages()
    expect(screen.getByLabelText('Collection size')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Sizing', expanded: true }))
    expect(screen.queryByLabelText('Collection size')).toBeNull()
  })

  it('returns to browse via Back', () => {
    openImages()
    fireEvent.click(screen.getByRole('button', { name: /All components/ }))
    expect(screen.queryByText('Live Shots')).toBeNull()
    expect(screen.getByRole('button', { name: /Images/ })).toBeTruthy()
  })

  it('exposes the collapsed component switcher strip with Images current', () => {
    openImages()
    const strip = screen.getByRole('button', { name: 'Images' })
    expect(strip.getAttribute('aria-current')).toBe('true')
    // the other types are reachable from the strip too
    expect(within(document.body).getByRole('button', { name: 'Videos' })).toBeTruthy()
  })
})
