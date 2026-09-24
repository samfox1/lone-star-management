// @vitest-environment jsdom
// Toasts must never cover the Publish bar's Revert and Publish (visual check, 2026-09-23).
/**
 * The toast stack sits bottom-right; the Brand Publish bar is docked across the bottom of
 * the screen, and its Revert and Publish are bottom-right too. A toast raised while the bar
 * is up (a save, a refusal) landed straight on top of them. So while the bar is up it lifts
 * the stack by its own height, and when it goes down (or away) the stack drops back.
 *
 * The REAL toast module and the REAL Toaster: the test is the two of them talking. jsdom
 * does no layout, so the bar's height is stubbed (offsetHeight) — the number the stack
 * moves by is exactly that stub, which is what proves the bar is the one moving it.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { PublishRiser } from '@/app/artists/[id]/(dashboard)/(manager-tools)/_ui/publish-riser'
import { Toaster, toast } from '@/app/artists/[id]/(dashboard)/toast'

const BAR_H = 77
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
const stackOf = (text: string) => screen.getByText(text).closest('button')!.parentElement as HTMLElement

describe('the toast stack clears the Publish bar', () => {
  it('CRITICAL: bar up lifts the stack by the bar\'s height; bar down drops it back', () => {
    const { rerender } = render(
      <>
        <Toaster />
        <PublishRiser dirty={false} message="" onPublish={ok} onRevert={vi.fn()} />
      </>,
    )
    act(() => toast('Saved'))
    const stack = stackOf('Saved')
    const rest = parseFloat(stack.style.bottom)
    expect(rest).toBeGreaterThan(0)

    rerender(
      <>
        <Toaster />
        <PublishRiser dirty message="Primary logo changed" onPublish={ok} onRevert={vi.fn()} />
      </>,
    )
    expect(parseFloat(stack.style.bottom)).toBe(rest + BAR_H)

    rerender(
      <>
        <Toaster />
        <PublishRiser dirty={false} message="" onPublish={ok} onRevert={vi.fn()} />
      </>,
    )
    expect(parseFloat(stack.style.bottom)).toBe(rest)
  })

  it('a bar that unmounts while up (a tab outside Brand) hands the space back', () => {
    const { rerender } = render(
      <>
        <Toaster />
        <PublishRiser dirty message="2 changes" onPublish={ok} />
      </>,
    )
    act(() => toast('Hello'))
    const stack = stackOf('Hello')
    const up = parseFloat(stack.style.bottom)
    expect(up).toBeGreaterThan(BAR_H) // lifted, and a number (NaN would pass the line below)
    rerender(<Toaster />)
    expect(parseFloat(stack.style.bottom)).toBe(up - BAR_H)
  })
})
