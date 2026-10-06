// @vitest-environment jsdom
// A press document's Remove: it asks first, then a quiet "removed" when it worked, the server's
//   words when it did not.
/**
 * DocumentUpload's trash. Batch 3 dropped its question (review of a77e297), so one click lost the
 * PDF with no way back but a re-upload; it asks again, like every other trash in these tools.
 * LIGHT: the look is still settling, so only the remove path is pinned, not the tile. The upload
 * itself is UploadField's and is stubbed here.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { DocumentUpload } from '@/app/artists/[id]/(dashboard)/(manager-tools)/epk/document-upload'
import { savePressDocumentAction } from '@/app/artists/[id]/(dashboard)/(manager-tools)/epk/actions'
import { toast } from '@/app/artists/[id]/(dashboard)/toast'

vi.mock('@/app/artists/[id]/(dashboard)/(manager-tools)/epk/actions', () => ({
  savePressDocumentAction: vi.fn(async () => ({})),
}))
vi.mock('@/app/artists/[id]/(dashboard)/toast', () => ({ toast: vi.fn() }))
vi.mock('@/app/artists/[id]/(dashboard)/upload-field', () => ({ UploadField: () => null }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

/** Press the trash, then answer its question. */
async function removeAnswering(answer: 'Confirm' | 'Cancel') {
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
  const question = screen.getByRole('dialog', { name: 'Remove the tech rider?' })
  await act(async () => fireEvent.click(within(question).getByRole('button', { name: answer })))
}

describe('DocumentUpload · Remove', () => {
  // The question is the only guard: a Cancel that still cleared would lose the PDF.
  it('asks first: Cancel sends nothing', async () => {
    render(<DocumentUpload artistId="a1" kind="tech_rider" label="Tech rider" hint="" present />)
    await removeAnswering('Cancel')
    expect(savePressDocumentAction).not.toHaveBeenCalled()
    expect(toast).not.toHaveBeenCalled()
  })

  // Confirmed, the path clears and says so; a refusal (RLS) says why and never "removed".
  it('confirmed, clears the document and says so quietly; a refusal says why and never "removed"', async () => {
    render(<DocumentUpload artistId="a1" kind="tech_rider" label="Tech rider" hint="" present />)

    await removeAnswering('Confirm')
    expect(savePressDocumentAction).toHaveBeenCalledWith('a1', 'tech_rider', null)
    expect(toast).toHaveBeenCalledWith('Tech rider removed')

    vi.mocked(toast).mockClear()
    vi.mocked(savePressDocumentAction).mockResolvedValueOnce({ error: 'Not found.' })
    await removeAnswering('Confirm')
    expect(vi.mocked(toast).mock.calls).toEqual([['Not found.', 'error']])
  })
})
