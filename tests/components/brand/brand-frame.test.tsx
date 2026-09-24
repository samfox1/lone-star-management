// @vitest-environment jsdom
// The frame every Brand tab shares: the brand-kit download and the brand Publish bar.
/**
 * BrandKitLink: a REAL link to /artists/<id>/brand/kit, named "Download brand kit" — a
 * button would need script to download, and the route checks ownership on its own.
 *
 * BrandRiser: PublishRiser bound to the BRAND publish and revert. The password reaches
 * publishBrandWithPasswordAction with this artist's id; Revert runs revertBrandAction for
 * this artist. The page refreshes only when either went through, a refusal is an error
 * toast, and a revert that restored NOTHING says so rather than passing as a success.
 *
 * brand/layout.tsx itself is an async server component (params + an async pending bar in
 * Suspense), which jsdom cannot render; it is these two pieces plus tsc.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { BrandKitLink } from '@/app/artists/[id]/(dashboard)/brand/_ui/brand-kit-link'
import { BrandRiser } from '@/app/artists/[id]/(dashboard)/brand/_ui/brand-riser'
import { publishBrandWithPasswordAction } from '@/app/artists/[id]/(dashboard)/actions'
import { revertBrandAction } from '@/app/artists/[id]/(dashboard)/brand/actions'
import { toast } from '@/app/artists/[id]/(dashboard)/toast'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
vi.mock('@/app/artists/[id]/(dashboard)/actions', () => ({ publishBrandWithPasswordAction: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/app/artists/[id]/(dashboard)/brand/actions', () => ({ revertBrandAction: vi.fn(async () => ({ changed: 2 })) }))
vi.mock('@/app/artists/[id]/(dashboard)/toast', () => ({ toast: vi.fn(), liftToasts: vi.fn() }))

afterEach(cleanup)

describe('BrandKitLink', () => {
  it('CRITICAL: a real link to this artist\'s brand kit, named for what it does', () => {
    render(<BrandKitLink artistId="a1" />)
    const link = screen.getByRole('link', { name: 'Download brand kit' })
    expect(link.tagName).toBe('A')
    expect(link.getAttribute('href')).toBe('/artists/a1/brand/kit')
    expect(link.querySelector('[data-icon="download"]')).not.toBeNull()
  })

  it('CRITICAL: its hover label prefers to right-align — the link is the rightmost thing on the page', () => {
    // Centred, the "Download brand kit" chip stuck out 17px past the right edge and gave
    // the page a horizontal scrollbar at 1440 and 390 (visual check, 2026-09-23). The chip
    // also shifts to stay on screen whatever it prefers (hover-label.test.tsx).
    render(<BrandKitLink artistId="a1" />)
    const marker = screen.getByRole('link', { name: 'Download brand kit' }).querySelector(':scope > [data-side]')!
    expect(marker.getAttribute('data-align')).toBe('end')
  })
})

describe('BrandRiser', () => {
  async function publish(password: string) {
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByPlaceholderText('Your password'), { target: { value: password } })
    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: 'Publish' })))
  }

  it('CRITICAL: publishes THIS artist\'s brand with the password, then refreshes', async () => {
    render(<BrandRiser artistId="a1" dirty message="Primary logo changed" canRevert />)
    await publish('s3cret')
    expect(publishBrandWithPasswordAction).toHaveBeenCalledWith('a1', 's3cret')
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('a refused publish does not refresh', async () => {
    vi.mocked(publishBrandWithPasswordAction).mockResolvedValueOnce({ ok: false, error: 'Incorrect password.' })
    render(<BrandRiser artistId="a1" dirty message="x" canRevert />)
    await publish('wrong')
    expect(refresh).not.toHaveBeenCalled()
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect password.')
  })

  it('nothing pending: the bar is out of reach', () => {
    render(<BrandRiser artistId="a1" dirty={false} message="" canRevert />)
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull()
  })

  async function revert() {
    fireEvent.click(screen.getByRole('button', { name: 'Revert' }))
    const confirm = await screen.findByRole('dialog', { name: /^Revert/ })
    await act(async () => fireEvent.click(within(confirm).getByRole('button', { name: 'Revert' })))
  }

  it('CRITICAL: Revert is wired — it reverts THIS artist\'s brand, then refreshes', async () => {
    render(<BrandRiser artistId="a1" dirty message="x" canRevert />)
    await revert()
    expect(revertBrandAction).toHaveBeenCalledTimes(1)
    expect(revertBrandAction).toHaveBeenCalledWith('a1')
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(toast).not.toHaveBeenCalled()
  })

  it('a refused revert is an ERROR toast with the action\'s reason, and no refresh', async () => {
    vi.mocked(revertBrandAction).mockResolvedValueOnce({ error: 'Nothing is on the site yet, so there is nothing to go back to.' })
    render(<BrandRiser artistId="a1" dirty message="x" canRevert />)
    await revert()
    expect(toast).toHaveBeenCalledWith('Nothing is on the site yet, so there is nothing to go back to.', 'error')
    expect(refresh).not.toHaveBeenCalled()
  })

  it('CRITICAL: a revert that restored NOTHING is not a silent success', async () => {
    vi.mocked(revertBrandAction).mockResolvedValueOnce({ changed: 0 })
    render(<BrandRiser artistId="a1" dirty message="x" canRevert />)
    await revert()
    expect(toast).toHaveBeenCalledTimes(1)
    expect(vi.mocked(toast).mock.lastCall![1]).toBe('error')
  })
})
