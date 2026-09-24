// @vitest-environment jsdom
// The Brand layout's bar offers Revert only when Revert can do something.
/**
 * BrandRiser (brand/_ui/brand-riser.tsx): PublishRiser bound to the brand publish and its
 * Revert. The layout hands it `loadBrandPending`'s answer, and `canRevert` decides whether
 * Revert is offered at all (fix round, 2026-09-23): a site never published, or a bar whose
 * only changes are kinds never published, has nothing to go back to — a Revert there could
 * only ever answer "nothing to go back to", which reads as broken.
 *
 * Which changes CAN be reverted is `brandPending`'s rule, pinned against the revert itself
 * in tests/unit/manager-tools/brand/brand-pending.test.ts. This file pins the wiring.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'

const h = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }))
vi.mock('@/app/artists/[id]/(dashboard)/toast', () => ({ toast: vi.fn(), liftToasts: vi.fn() }))
vi.mock('@/app/artists/[id]/(dashboard)/actions', () => ({ publishBrandWithPasswordAction: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/app/artists/[id]/(dashboard)/(manager-tools)/brand/actions', () => ({ revertBrandAction: vi.fn(async () => ({ changed: 2 })) }))

import { BrandRiser } from '@/app/artists/[id]/(dashboard)/(manager-tools)/brand/_ui/brand-riser'
import { revertBrandAction } from '@/app/artists/[id]/(dashboard)/(manager-tools)/brand/actions'
import { BRAND_REVERTED } from '@/app/artists/[id]/(dashboard)/(manager-tools)/brand/_ui/brand-events'

afterEach(cleanup)

const bar = () => document.querySelector('[data-publish-riser]') as HTMLElement

describe('BrandRiser', () => {
  it('CRITICAL: nothing Revert could put back → the bar shows Publish and NO Revert', () => {
    render(<BrandRiser artistId="a1" dirty message="Primary logo added" canRevert={false} />)
    expect(within(bar()).getByRole('button', { name: 'Publish' })).toBeTruthy()
    expect(within(bar()).queryByRole('button', { name: 'Revert' })).toBeNull()
  })

  it('CRITICAL: a revertable change → Revert is there, and it reverts THIS artist', async () => {
    render(<BrandRiser artistId="a1" dirty message="Primary logo changed" canRevert />)
    fireEvent.click(within(bar()).getByRole('button', { name: 'Revert' }))
    const ask = await screen.findByRole('dialog', { name: /Revert every brand change/ })
    await act(async () => {
      fireEvent.click(within(ask).getByRole('button', { name: 'Revert' }))
    })
    expect(revertBrandAction).toHaveBeenCalledWith('a1')
    expect(h.refresh).toHaveBeenCalled()
  })

  it('CRITICAL: a revert that changed something is ANNOUNCED — the Colors tab re-seeds from it; one that failed is not', async () => {
    // Colours publish now (20260925120000), so Revert can change the palette the Colors tab
    // holds its own copy of (brand-events.ts). Only a revert that DID something says so.
    const heard = vi.fn()
    window.addEventListener(BRAND_REVERTED, heard)
    const revert = async () => {
      fireEvent.click(within(bar()).getByRole('button', { name: 'Revert' }))
      const ask = await screen.findByRole('dialog', { name: /Revert every brand change/ })
      await act(async () => {
        fireEvent.click(within(ask).getByRole('button', { name: 'Revert' }))
      })
    }
    try {
      render(<BrandRiser artistId="a1" dirty message="Cream changed" canRevert />)
      await revert()
      expect(heard).toHaveBeenCalledTimes(1)
      cleanup()
      vi.mocked(revertBrandAction).mockResolvedValueOnce({ error: 'Could not undo those changes.' })
      render(<BrandRiser artistId="a1" dirty message="Cream changed" canRevert />)
      await revert()
      expect(heard).toHaveBeenCalledTimes(1)
    } finally {
      window.removeEventListener(BRAND_REVERTED, heard)
    }
  })
})
