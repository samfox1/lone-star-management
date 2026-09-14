// @vitest-environment jsdom
// A logo row: the mark with two bare glyphs beside it, or a dashed square that is the picker.
/**
 * LogoRow (Sam, 2026-09-13) replaced LogoUpload's drop zone + captions. What has to hold:
 *
 *   - Remove asks first; a declined ask does nothing;
 *   - removing the PRIMARY logo also clears the derived favicon; the SECONDARY does not;
 *   - a failed Remove is surfaced and does NOT go on to clear the favicon;
 *   - an empty slot offers Add and no Remove;
 *   - the picker offers exactly the validated allowlist — no SVG, no wildcard;
 *   - clicking the mark opens it large, with Replace and a Remove that asks first.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { LogoRow } from '@/app/artists/[id]/(dashboard)/brand/logo-row'
import { setBrandAssetAction } from '@/app/artists/[id]/(dashboard)/brand/actions'
import { toast } from '@/app/artists/[id]/(dashboard)/toast'
import { IMAGE_UPLOAD_RULES, acceptFor } from '@/lib/upload'

vi.mock('@/app/artists/[id]/(dashboard)/brand/actions', () => ({
  setBrandAssetAction: vi.fn(async () => ({})),
}))
vi.mock('@/app/artists/[id]/(dashboard)/toast', () => ({ toast: vi.fn() }))
vi.mock('@/app/artists/[id]/(dashboard)/use-storage-upload', () => ({
  useStorageUpload: () => ({ busy: false, error: null, progress: null, upload: vi.fn() }),
}))
vi.mock('@/app/artists/[id]/(dashboard)/budget-gate', () => ({
  useBudgetGate: () => ({ prepare: async (f: File) => f, modal: null }),
}))

const mockedAction = vi.mocked(setBrandAssetAction)
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function mount(purpose: 'logo_primary' | 'logo_secondary', url: string | null = 'https://cdn/x.png') {
  const label = purpose === 'logo_primary' ? 'Primary logo' : 'Secondary logo'
  render(<LogoRow artistId="a1" purpose={purpose} label={label} currentUrl={url} />)
  return label
}
async function removeAndAnswer(label: string, answer: 'Remove' | 'Cancel') {
  fireEvent.click(screen.getByRole('button', { name: `Remove ${label.toLowerCase()}` }))
  const q = screen.getByRole('dialog', { name: /Remove the/ })
  await act(async () => {
    fireEvent.click(within(q).getByRole('button', { name: answer }))
  })
}

describe('LogoRow', () => {
  it('CRITICAL: Remove asks first, and a declined ask removes nothing', async () => {
    const label = mount('logo_primary')
    await removeAndAnswer(label, 'Cancel')
    expect(mockedAction).not.toHaveBeenCalled()
  })

  it('CRITICAL: removing the PRIMARY logo also clears the derived favicon', async () => {
    const label = mount('logo_primary')
    await removeAndAnswer(label, 'Remove')
    expect(mockedAction).toHaveBeenNthCalledWith(1, 'a1', 'logo_primary', null)
    expect(mockedAction).toHaveBeenNthCalledWith(2, 'a1', 'favicon', null)
  })

  it('removing the SECONDARY logo leaves the favicon alone — it is not derived from it', async () => {
    const label = mount('logo_secondary')
    await removeAndAnswer(label, 'Remove')
    expect(mockedAction).toHaveBeenCalledTimes(1)
    expect(mockedAction).toHaveBeenCalledWith('a1', 'logo_secondary', null)
  })

  it('CRITICAL: a failed Remove is surfaced, and does NOT go on to clear the favicon', async () => {
    mockedAction.mockResolvedValueOnce({ error: 'permission denied' })
    const label = mount('logo_primary')
    await removeAndAnswer(label, 'Remove')
    expect(toast).toHaveBeenCalledWith('permission denied', 'error')
    expect(mockedAction).toHaveBeenCalledTimes(1)
  })

  it('an empty slot offers Add and no Remove — the dashed square is the picker', () => {
    mount('logo_secondary', null)
    expect(screen.getByRole('button', { name: 'Add secondary logo' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Replace/ })).toBeNull()
  })

  it('CRITICAL: the picker offers exactly the validated allowlist — no SVG, no wildcard', () => {
    mount('logo_primary')
    const input = screen.getByLabelText('Primary logo file')
    expect(input).toHaveAttribute('accept', acceptFor(IMAGE_UPLOAD_RULES))
    expect(input.getAttribute('accept')).not.toMatch(/svg|image\/\*/)
  })
})

describe('the bigger view', () => {
  it('opens on click with the mark large, Replace, and a Remove that asks first', async () => {
    const label = mount('logo_primary')
    fireEvent.click(screen.getByRole('button', { name: `View ${label.toLowerCase()}` }))
    const modal = screen.getByRole('dialog', { name: label })
    expect(within(modal).getByRole('img', { name: label })).toBeInTheDocument()
    expect(within(modal).getByRole('button', { name: /Replace/ })).toBeInTheDocument()
    fireEvent.click(within(modal).getByRole('button', { name: 'Remove' }))
    expect(mockedAction).not.toHaveBeenCalled()
    const q = screen.getByRole('dialog', { name: /Remove the primary logo/ })
    await act(async () => {
      fireEvent.click(within(q).getByRole('button', { name: 'Remove' }))
    })
    expect(mockedAction).toHaveBeenNthCalledWith(1, 'a1', 'logo_primary', null)
    expect(mockedAction).toHaveBeenNthCalledWith(2, 'a1', 'favicon', null)
  })
})
