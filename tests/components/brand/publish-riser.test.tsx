// @vitest-environment jsdom
// The Brand page's one Publish bar: bottom of the screen, bigger, hidden until a real change.
/**
 * PublishRiser (BRAND_PAGE_PLAN.md, Sam 2026-09-23). What has to hold:
 *   - hidden until `dirty` — translated OFF-SCREEN, and out of reach (aria-hidden + inert),
 *     not merely transparent: a see-through bar still catches clicks and Tab stops;
 *   - dirty: red dot + the message, Publish, and Revert only when there is an onRevert;
 *   - Publish opens the SAME password dialog PublishBar uses (publish-bar.tsx's
 *     PublishPasswordDialog), and hands it the password;
 *   - Revert asks first, runs once however fast it is pressed, and a refusal is an error
 *     toast;
 *   - the slide respects prefers-reduced-motion; the bar is bigger than PublishBar.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { PublishRiser } from '@/app/artists/[id]/(dashboard)/brand/_ui/publish-riser'
import { PublishPasswordDialog } from '@/app/artists/[id]/(dashboard)/publish-bar'
import { toast } from '@/app/artists/[id]/(dashboard)/toast'

vi.mock('@/app/artists/[id]/(dashboard)/toast', () => ({ toast: vi.fn(), liftToasts: vi.fn() }))
// The REAL dialog, wrapped in a spy: the test proves the riser renders PublishBar's own
// dialog (not a look-alike) and then drives that dialog for real.
vi.mock('@/app/artists/[id]/(dashboard)/publish-bar', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/app/artists/[id]/(dashboard)/publish-bar')>()
  return { ...real, PublishPasswordDialog: vi.fn(real.PublishPasswordDialog) }
})

afterEach(cleanup)

const bar = () => document.querySelector('[data-publish-riser]') as HTMLElement
const ok = vi.fn(async () => ({ ok: true }))

describe('PublishRiser', () => {
  it('CRITICAL: hidden until dirty — off-screen AND out of reach, not just transparent', () => {
    render(<PublishRiser dirty={false} message="Primary logo changed" onPublish={ok} onRevert={vi.fn()} />)
    const el = bar()
    expect(el.className).toMatch(/(^|\s)translate-y-\[110%\](\s|$)/)
    expect(el.getAttribute('aria-hidden')).toBe('true')
    expect(el.hasAttribute('inert')).toBe(true)
    // Its upward shadow is 32px tall and would show above the viewport's bottom edge while
    // the bar sits just below it (seen in the 2026-09-23 screenshot): no shadow while hidden.
    expect(el.className).not.toMatch(/(^|\s)shadow-/)
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Revert' })).toBeNull()
  })

  it('CRITICAL: dirty — slides up with a red dot, the message, and Publish', () => {
    // The loader says only WHAT changed ("Primary logo changed", "2 changes"); the bar adds
    // "· not on the site yet" itself (BRAND_PAGE_PLAN.md). Passing the suffix in here, as
    // this test once did, would pass whether or not the bar ever wrote it.
    render(<PublishRiser dirty message="Primary logo changed" onPublish={ok} />)
    const el = bar()
    expect(el.className).toMatch(/(^|\s)translate-y-0(\s|$)/)
    expect(el.className).not.toMatch(/translate-y-\[110%\]/)
    expect(el.getAttribute('aria-hidden')).toBeNull()
    expect(el.hasAttribute('inert')).toBe(false)
    expect(el.className).toMatch(/(^|\s)shadow-\[/)
    expect(within(el).getByText('Primary logo changed · not on the site yet').className).toContain('text-[15px]')
    // Once, not doubled by a caller that already had it.
    expect(el.textContent!.match(/not on the site yet/g)).toHaveLength(1)
    expect(el.querySelector('.bg-accent-red')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Publish' })).toBeTruthy()
  })

  it('the suffix follows any count: "2 changes · not on the site yet"', () => {
    render(<PublishRiser dirty message="2 changes" onPublish={ok} />)
    expect(within(bar()).getByText('2 changes · not on the site yet')).toBeTruthy()
  })

  it('Revert is rendered only when there is an onRevert', () => {
    render(<PublishRiser dirty message="x" onPublish={ok} />)
    expect(screen.queryByRole('button', { name: 'Revert' })).toBeNull()
    cleanup()
    render(<PublishRiser dirty message="x" onPublish={ok} onRevert={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Revert' })).toBeTruthy()
  })

  it('CRITICAL: Publish opens PublishBar\'s OWN password dialog and hands it the password', async () => {
    const onPublish = vi.fn(async () => ({ ok: true }))
    render(<PublishRiser dirty message="x" onPublish={onPublish} noun="brand" />)
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    const lastProps = vi.mocked(PublishPasswordDialog).mock.lastCall![0]
    expect(lastProps.open).toBe(true)
    expect(lastProps.onPublish).toBe(onPublish)
    expect(lastProps.noun).toBe('brand')

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Publish to the site')).toBeTruthy()
    fireEvent.change(within(dialog).getByPlaceholderText('Your password'), { target: { value: 's3cret' } })
    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: 'Publish' })))
    expect(onPublish).toHaveBeenCalledTimes(1)
    expect(onPublish).toHaveBeenCalledWith('s3cret')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('the password prompt does not outlive the change it would publish', () => {
    // A refresh that brings `dirty: false` (the change was published or reverted from
    // another tab) hides the bar; a prompt left open over it would publish nothing — or,
    // worse, whatever changes next. Unpinned until 2026-09-23.
    const { rerender } = render(<PublishRiser dirty message="x" onPublish={ok} />)
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    rerender(<PublishRiser dirty={false} message="" onPublish={ok} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('CRITICAL: …and does not come BACK on the next change, password still typed (one Enter would publish)', () => {
    // Review 2 (2026-09-24): hiding the prompt behind `open && dirty` left `open` true and
    // the dialog's password in place, so the next change reopened it by itself, filled in.
    const { rerender } = render(<PublishRiser dirty message="x" onPublish={ok} />)
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    fireEvent.change(screen.getByPlaceholderText('Your password'), { target: { value: 'hunter2' } })
    rerender(<PublishRiser dirty={false} message="" onPublish={ok} />) // published from another tab
    expect(screen.queryByRole('dialog')).toBeNull()
    rerender(<PublishRiser dirty message="Tour logo added" onPublish={ok} />) // the next change
    expect(screen.queryByRole('dialog'), 'the prompt reopened by itself').toBeNull()
    // Asked for again, it starts empty.
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    expect((screen.getByPlaceholderText('Your password') as HTMLInputElement).value).toBe('')
  })

  it('a wrong password keeps the dialog open with the reason', async () => {
    render(<PublishRiser dirty message="x" onPublish={async () => ({ ok: false, error: 'Incorrect password.' })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByPlaceholderText('Your password'), { target: { value: 'nope' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Publish' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect password.')
  })

  it('CRITICAL: Revert asks first — No reverts nothing, Yes reverts once', async () => {
    const onRevert = vi.fn(async () => undefined)
    render(<PublishRiser dirty message="x" onPublish={ok} onRevert={onRevert} />)

    fireEvent.click(screen.getByRole('button', { name: 'Revert' }))
    await act(async () => fireEvent.click(await screen.findByRole('button', { name: 'Cancel' })))
    expect(onRevert).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Revert' }))
    const confirm = await screen.findByRole('dialog', { name: /^Revert/ })
    await act(async () => fireEvent.click(within(confirm).getByRole('button', { name: 'Revert' })))
    expect(onRevert).toHaveBeenCalledTimes(1)
  })

  it('CRITICAL: while a revert is running, Revert cannot start a second one', async () => {
    let release!: () => void
    const onRevert = vi.fn(() => new Promise<void>((r) => (release = r)))
    render(<PublishRiser dirty message="x" onPublish={ok} onRevert={onRevert} />)
    fireEvent.click(screen.getByRole('button', { name: 'Revert' }))
    const confirm = await screen.findByRole('dialog', { name: /^Revert/ })
    await act(async () => fireEvent.click(within(confirm).getByRole('button', { name: 'Revert' })))
    expect(onRevert).toHaveBeenCalledTimes(1)

    // In flight: a second press asks nothing and reverts nothing.
    fireEvent.click(screen.getByRole('button', { name: /Revert/ }))
    expect(screen.queryByRole('dialog', { name: /^Revert/ })).toBeNull()
    await act(async () => release())
    expect(onRevert).toHaveBeenCalledTimes(1)
  })

  it('a refused revert is an ERROR toast', async () => {
    render(<PublishRiser dirty message="x" onPublish={ok} onRevert={async () => ({ error: 'Nothing to revert.' })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Revert' }))
    const confirm = await screen.findByRole('dialog', { name: /^Revert/ })
    await act(async () => fireEvent.click(within(confirm).getByRole('button', { name: 'Revert' })))
    expect(toast).toHaveBeenCalledWith('Nothing to revert.', 'error')
  })

  it('the slide respects prefers-reduced-motion, and the bar is bigger than PublishBar', () => {
    render(<PublishRiser dirty message="x" onPublish={ok} onRevert={vi.fn()} />)
    const cls = bar().className.split(/\s+/)
    // Motion only under motion-safe: a bare transition would animate for everyone.
    expect(cls).toContain('motion-safe:transition-transform')
    expect(cls.filter((c) => /^transition/.test(c))).toEqual([])
    expect(cls).toContain('fixed')
    expect(cls).toContain('bottom-0')
    expect(screen.getByRole('button', { name: 'Publish' }).className).toContain('text-[14px]')
    expect(screen.getByRole('button', { name: 'Revert' }).className).toContain('text-[14px]')
  })
})
