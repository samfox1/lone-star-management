// @vitest-environment jsdom
// Three device shares, of everyone, and nothing per browser.
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DeviceSplit } from '@/components/ui/device-split'
import { DEVICE_KINDS, summarizeDevices } from '@/lib/analytics'

const row = (device: string, browser: string, visitors: number) => ({ device, browser, visitors, views: visitors * 2 })
const shares = summarizeDevices([
  row('mobile', 'instagram', 200), row('mobile', 'chrome', 96), row('tablet', 'safari', 13),
  row('desktop', 'chrome', 88), row('desktop', 'safari', 42), row('', '', 9),
])

describe('DeviceSplit', () => {
  it('CRITICAL: one figure per kind from the registry, each a share of EVERYONE — 296 + 13 + 130 + 9 unclassified = 448', () => {
    const { container } = render(<DeviceSplit shares={shares} />)
    const terms = screen.getAllByRole('term').map((t) => t.textContent)
    expect(terms).toEqual(DEVICE_KINDS.map((k) => k.label))
    const text = container.textContent!
    expect(text).toMatch(/Mobile66%296 visitors/)
    expect(text).toMatch(/Tablet3%13 visitors/)
    expect(text).toMatch(/Computer29%130 visitors/)
  })

  it('names no browser — the question is which view of the site to build, not which engine renders it', () => {
    render(<DeviceSplit shares={shares} />)
    expect(screen.queryByText(/chrome|safari|instagram/i)).toBeNull()
  })

  it('every kind carries its device mark', () => {
    render(<DeviceSplit shares={shares} />)
    for (const t of screen.getAllByRole('term')) expect(t.querySelector('svg'), t.textContent ?? '').not.toBeNull()
  })

  it('counts the unclassified rather than hiding them, and says nothing when there are none', () => {
    render(<DeviceSplit shares={shares} />)
    expect(screen.getByText(/9 visitors on something the door could not classify/i)).toBeTruthy()
    const clean = render(<DeviceSplit shares={summarizeDevices([row('mobile', 'safari', 1)])} />)
    expect(clean.container.textContent).not.toMatch(/classify/)
    expect(clean.container.textContent).toMatch(/1 visitor(?!s)/)
  })

  it('says what is missing rather than drawing three zeros', () => {
    render(<DeviceSplit shares={summarizeDevices([])} empty="No visits yet." />)
    expect(screen.getByText('No visits yet.')).toBeTruthy()
    expect(screen.queryByText('0%')).toBeNull()
  })
})
