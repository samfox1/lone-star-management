// @vitest-environment jsdom
// The device waffle: a hundred squares, one per percent of everyone, and the three figures beside it.
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
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

  it('the legend is one figure per kind from the registry, each a share of EVERYONE, and no browser', () => {
    const { container } = render(<DeviceSplit shares={shares} />)
    expect(screen.getAllByRole('term').slice(0, 3).map((t) => t.textContent)).toEqual(DEVICE_KINDS.map((k) => k.label))
    const text = container.textContent!
    expect(text).toMatch(/Mobile66%296 visitors/)
    expect(text).toMatch(/Tablet3%13 visitors/)
    expect(text).toMatch(/Computer29%130 visitors/)
    expect(text).not.toMatch(/chrome|safari|instagram/i)
    expect(text).toMatch(/9 visitors on something the door could not classify/i)
  })

  it('every kind carries its device mark', () => {
    render(<DeviceSplit shares={shares} />)
    for (const t of screen.getAllByRole('term').slice(0, 3)) expect(t.parentElement!.querySelector('svg'), t.textContent ?? '').not.toBeNull()
  })

  it('says what is missing rather than drawing an empty grid', () => {
    const { container } = render(<DeviceSplit shares={summarizeDevices([])} empty="No visits yet." />)
    expect(screen.getByText('No visits yet.')).toBeTruthy()
    expect(container.querySelector('[data-waffle]')).toBeNull()
  })
})
