// @vitest-environment jsdom
// Devices as two groups on ONE scale, each row carrying its marks.
import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { DeviceSplit } from '@/components/ui/device-split'
import { summarizeDevices } from '@/lib/analytics'

const row = (device: string, browser: string, visitors: number) => ({ device, browser, visitors, views: visitors * 2 })
const split = summarizeDevices([
  row('mobile', 'instagram', 200), row('mobile', 'chrome', 96), row('tablet', 'safari', 13),
  row('desktop', 'chrome', 88), row('desktop', 'safari', 42), row('', '', 9),
])
const widths = (el: HTMLElement) => [...el.querySelectorAll('[data-bar]')].map((b) => parseFloat((b as HTMLElement).style.width))

describe('DeviceSplit', () => {
  it('draws the two groups with their totals and shares', () => {
    render(<DeviceSplit split={split} />)
    const mobile = screen.getByRole('region', { name: 'Mobile' })
    const web = screen.getByRole('region', { name: 'Web' })
    // Shares are of EVERYONE, the unclassified included: 309 and 130 of 448.
    expect(mobile.textContent).toContain('309 · 69%')
    expect(web.textContent).toContain('130 · 29%')
    expect(within(mobile).getAllByRole('listitem')).toHaveLength(3)
    expect(within(web).getAllByRole('listitem')).toHaveLength(2)
  })

  it('CRITICAL: a web bar and a mobile bar share one scale — the leader is full, the rest proportional', () => {
    render(<DeviceSplit split={split} />)
    const m = widths(screen.getByRole('region', { name: 'Mobile' }))
    const w = widths(screen.getByRole('region', { name: 'Web' }))
    expect(m[0]).toBe(100)
    // Chrome on desktop is 88 of 200, not 100 of its own group.
    expect(w[0]).toBeCloseTo(44, 5)
  })

  it('every row carries a device mark and a browser mark', () => {
    render(<DeviceSplit split={split} />)
    for (const li of screen.getAllByRole('listitem')) {
      expect(li.querySelectorAll('svg').length, li.textContent ?? '').toBe(2)
    }
  })

  it('reads as the browser alone, since the group and the mark already say the device', () => {
    render(<DeviceSplit split={split} />)
    const mobile = screen.getByRole('region', { name: 'Mobile' })
    expect(within(mobile).getByText('Instagram')).toBeTruthy()
    expect(within(mobile).queryByText(/^Mobile Instagram$/)).toBeNull()
    // Except a tablet, which is worth a word because a phone is the default reading.
    expect(within(mobile).getByText('tablet')).toBeTruthy()
  })

  it('counts the unclassified rather than hiding them', () => {
    render(<DeviceSplit split={split} />)
    expect(screen.getByText(/9 visitors on something the door could not classify/i)).toBeTruthy()
  })

  it('says what is missing rather than drawing two empty columns', () => {
    render(<DeviceSplit split={summarizeDevices([])} empty="No visits yet." />)
    expect(screen.getByText('No visits yet.')).toBeTruthy()
  })
})
