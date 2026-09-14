// @vitest-environment jsdom
// The device waffle: a hundred squares, one per percent of everyone, and the three figures beside it.
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { DeviceSplit } from '@/components/ui/device-split'
import { DEVICE_KINDS, summarizeDevices, waffleCells } from '@/lib/analytics'

const row = (device: string, browser: string, visitors: number) => ({ device, browser, visitors, views: visitors * 2 })
const shares = summarizeDevices([
  row('mobile', 'instagram', 200), row('mobile', 'chrome', 96), row('tablet', 'safari', 13),
  row('desktop', 'chrome', 88), row('desktop', 'safari', 42), row('', '', 9),
])
const cellsOf = (c: HTMLElement) => [...c.querySelectorAll('[data-waffle] [data-cell]')].map((el) => el.getAttribute('data-cell'))

describe('DeviceSplit', () => {
  it('CRITICAL: the grid IS the data — a hundred cells, laid out exactly as waffleCells says', () => {
    const { container } = render(<DeviceSplit shares={shares} />)
    const cells = cellsOf(container)
    expect(cells).toHaveLength(100)
    expect(cells).toEqual(waffleCells(shares))
    expect(screen.getByRole('img', { name: '66% mobile, 3% tablet, 29% computer' })).toBeTruthy()
  })

  it('CRITICAL: colour follows the device, never the rank — mobile blue, tablet red, computer ink, unclassified grey', () => {
    const { container } = render(<DeviceSplit shares={shares} />)
    const cls = (kind: string) => container.querySelector(`[data-waffle] [data-cell="${kind}"]`)!.className
    expect(cls('mobile')).toMatch(/\bbg-accent\b/)
    expect(cls('tablet')).toMatch(/\bbg-accent-red\b/)
    expect(cls('desktop')).toMatch(/\bbg-ink\b/)
    expect(cls('other')).toMatch(/\bbg-hairline\b/)
    // Flip the ranking: tablet leads, and it is still red.
    const flipped = render(<DeviceSplit shares={summarizeDevices([row('tablet', 'safari', 90), row('mobile', 'safari', 10)])} />)
    expect(flipped.container.querySelector('[data-waffle] [data-cell="tablet"]')!.className).toMatch(/\bbg-accent-red\b/)
  })

  it('the legend is the three names from the registry with their marks — no numbers until you hover, no browser', () => {
    const { container } = render(<DeviceSplit shares={shares} />)
    const rows = within(screen.getByRole('list', { name: 'Devices' })).getAllByRole('listitem')
    expect(rows.slice(0, 3).map((r) => r.textContent)).toEqual(DEVICE_KINDS.map((k) => k.label))
    for (const r of rows.slice(0, 3)) expect(r.querySelector('svg'), r.textContent ?? '').not.toBeNull()
    expect(container.textContent).not.toMatch(/chrome|safari|instagram|visitors/i)
    // The unclassified are named as a share: 9 of 448.
    expect(rows[3].textContent).toMatch(/^2% unclassified$/i)
  })

  it('CRITICAL: hovering a square shows that kind\'s share, lights its block, fades the rest, and leaving clears it', () => {
    const { container } = render(<DeviceSplit shares={shares} />)
    const tablet = container.querySelector('[data-waffle] [data-cell="tablet"]')!
    fireEvent.pointerMove(tablet, { clientX: 40, clientY: 30 })
    expect(screen.getByRole('status').textContent).toMatch(/^3% Tablet$/i)
    // Every other kind's cells and legend rows are dimmed; tablet's are not.
    expect(container.querySelectorAll('[data-cell="mobile"][data-dim]')).toHaveLength(66)
    expect(container.querySelectorAll('[data-cell="tablet"][data-dim]')).toHaveLength(0)
    expect(container.querySelector('[data-legend="mobile"]')!.className).toMatch(/opacity-40/)
    expect(container.querySelector('[data-legend="tablet"]')!.className).not.toMatch(/opacity-40/)
    // Move to a mobile square: the readout follows.
    fireEvent.pointerMove(container.querySelector('[data-waffle] [data-cell="mobile"]')!, { clientX: 10, clientY: 10 })
    expect(screen.getByRole('status').textContent).toMatch(/^66% Mobile$/i)
    fireEvent.pointerLeave(container.querySelector('[data-waffle]')!.parentElement!)
    expect(screen.queryByRole('status')).toBeNull()
    expect(container.querySelectorAll('[data-dim]')).toHaveLength(0)
  })

  it('says what is missing rather than drawing an empty grid', () => {
    const { container } = render(<DeviceSplit shares={summarizeDevices([])} empty="No visits yet." />)
    expect(screen.getByText('No visits yet.')).toBeTruthy()
    expect(container.querySelector('[data-waffle]')).toBeNull()
  })
})
