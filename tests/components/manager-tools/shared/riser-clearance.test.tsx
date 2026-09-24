// @vitest-environment jsdom
// The Publish bar never hides the page under it, and never cuts its own message short.
/**
 * Review 2 (2026-09-24), two LOW findings about the bar's footprint:
 *
 *  1. The bar is `fixed` over the bottom of the screen, so it takes no room in the page.
 *     The Brand layout's fixed `pb-28` was all the clearance there was, and while the bar
 *     was up the bottom colour row's panel ran under it — its hex box covered. The bar now
 *     adds an in-flow spacer as tall as ITSELF while it is up (measured, like the toast
 *     lift in riser-toasts.test.tsx), and none while it is down.
 *  2. On a phone the message was `truncate`d, and what the ellipsis ate was the one part
 *     every message shares: "· not on the site yet". It wraps now instead.
 *
 * jsdom does no layout, so the bar's height is stubbed (offsetHeight): the spacer's height
 * is exactly that stub, which is what proves it is the bar's own measurement.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { PublishRiser } from '@/app/artists/[id]/(dashboard)/(manager-tools)/_ui/publish-riser'

vi.mock('@/app/artists/[id]/(dashboard)/toast', () => ({ toast: vi.fn(), liftToasts: vi.fn() }))

const BAR_H = 83
const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute('data-publish-riser') ? BAR_H : 0
    },
  })
})
afterAll(() => {
  if (original) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', original)
})
afterEach(cleanup)

const ok = vi.fn(async () => ({ ok: true }))
const bar = () => document.querySelector('[data-publish-riser]') as HTMLElement
const spacer = () => document.querySelector('[data-publish-riser-spacer]') as HTMLElement | null
const spacerHeight = () => parseFloat(spacer()?.style.height || '0') || 0

describe('the page clears the bar', () => {
  it('CRITICAL: bar up → an in-flow spacer as tall as the bar; bar down → none', () => {
    const { rerender } = render(<PublishRiser dirty={false} message="" onPublish={ok} />)
    expect(spacerHeight()).toBe(0)

    rerender(<PublishRiser dirty message="Primary logo changed" onPublish={ok} />)
    expect(spacer(), 'no spacer: the fixed bar takes no room, so the page ends under it').not.toBeNull()
    expect(spacerHeight()).toBe(BAR_H)
    // In the page's flow — not part of the fixed bar, not positioned out of the flow.
    expect(bar().contains(spacer())).toBe(false)
    expect(spacer()!.className).not.toMatch(/(^|\s)(fixed|absolute)(\s|$)/)

    rerender(<PublishRiser dirty={false} message="" onPublish={ok} />)
    expect(spacerHeight()).toBe(0)
  })
})

describe('the message is never cut short', () => {
  it('CRITICAL: "· not on the site yet" can wrap, never be truncated away', () => {
    render(<PublishRiser dirty message="Fonts changed" onPublish={ok} />)
    const cutters = /(^|\s)(truncate|text-ellipsis|whitespace-nowrap|line-clamp-\d+)(\s|$)/
    let el: HTMLElement | null = screen.getByText('Fonts changed · not on the site yet')
    while (el && el !== bar().parentElement) {
      expect(el.className, `<${el.tagName.toLowerCase()}> would cut the message`).not.toMatch(cutters)
      el = el.parentElement
    }
  })
})
