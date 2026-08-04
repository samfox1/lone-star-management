// @vitest-environment jsdom
/**
 * LogoUpload — the two logo slots.
 *
 * Added during the Brand review: this component had no tests, and two of its behaviours
 * are invisible from anywhere else.
 *
 * 1. The favicon is DERIVED from the primary logo. Removing the logo must remove the
 *    derived icon too, or the public site keeps serving a tab icon built from a logo the
 *    artist deleted, while the Brand page reports there is no icon to configure. The UI
 *    and the live site disagree and nothing in the UI can reconcile them.
 * 2. `clear()` used to discard the action's error, so a Remove blocked by RLS was
 *    indistinguishable from one that worked.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LogoUpload } from '@/app/artists/[id]/(dashboard)/brand/logo-upload'
import { setBrandAssetAction } from '@/app/artists/[id]/(dashboard)/brand/actions'
import { toast } from '@/app/artists/[id]/(dashboard)/toast'
import { acceptFor, IMAGE_UPLOAD_RULES } from '@/lib/upload'

vi.mock('@/app/artists/[id]/(dashboard)/brand/actions', () => ({
  setBrandAssetAction: vi.fn(async () => ({})),
}))
vi.mock('@/app/artists/[id]/(dashboard)/toast', () => ({ toast: vi.fn() }))
vi.mock('@/app/artists/[id]/(dashboard)/use-storage-upload', () => ({
  useStorageUpload: () => ({ busy: false, error: null, upload: vi.fn(), progress: null, reset: vi.fn() }),
}))

const mockedAction = vi.mocked(setBrandAssetAction)
const mockedToast = vi.mocked(toast)

beforeEach(() => {
  mockedAction.mockClear()
  mockedAction.mockResolvedValue({})
  mockedToast.mockClear()
})
afterEach(cleanup)

const renderPrimary = (currentUrl: string | null = 'https://img.example/logo.png') =>
  render(
    <LogoUpload artistId="a1" purpose="logo_primary" label="Primary logo" hint="h" currentUrl={currentUrl} />,
  )

const clickRemove = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
  })
}

describe('LogoUpload — removing', () => {
  it('CRITICAL: removing the PRIMARY logo also clears the derived favicon', async () => {
    renderPrimary()
    await clickRemove()
    expect(mockedAction.mock.calls.map((c) => [c[1], c[2]])).toEqual([
      ['logo_primary', null],
      ['favicon', null],
    ])
  })

  it('removing the SECONDARY logo leaves the favicon alone — it is not derived from it', async () => {
    render(
      <LogoUpload artistId="a1" purpose="logo_secondary" label="Secondary logo" hint="h" currentUrl="https://x/l.png" />,
    )
    await clickRemove()
    expect(mockedAction.mock.calls.map((c) => c[1])).toEqual(['logo_secondary'])
  })

  it('CRITICAL: a failed Remove is surfaced, not silently swallowed', async () => {
    mockedAction.mockResolvedValueOnce({ error: 'permission denied' })
    renderPrimary()
    await clickRemove()
    expect(mockedToast).toHaveBeenCalledWith('permission denied', 'error')
  })

  it('a failed Remove does NOT go on to clear the favicon', async () => {
    // Otherwise a blocked logo delete would still strip the tab icon — the site would
    // lose its favicon while keeping the logo that produced it.
    mockedAction.mockResolvedValueOnce({ error: 'permission denied' })
    renderPrimary()
    await clickRemove()
    expect(mockedAction).toHaveBeenCalledTimes(1)
  })

  it('offers no Remove button when the slot is empty', () => {
    renderPrimary(null)
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
  })
})

describe('LogoUpload — accepted formats', () => {
  it('CRITICAL: the picker offers exactly the validated allowlist — no SVG, no wildcard', () => {
    // The old check asserted accept didn't CONTAIN "svg" while the component rendered
    // accept="image/*" — which admits SVG in a real picker. The picker must advertise
    // only what validateUpload accepts: the media bucket is public, and an SVG can
    // carry script.
    renderPrimary(null)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    expect(input.accept).toBe(acceptFor(IMAGE_UPLOAD_RULES))
    expect(input.accept).not.toMatch(/svg/i)
    expect(input.accept).not.toContain('*')
  })
})
