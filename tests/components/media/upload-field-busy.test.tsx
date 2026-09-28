// @vitest-environment jsdom
// UploadField tells its caller when an upload starts and ends (`onBusyChange`).
/**
 * A caller that must not close while its file is still going up (the Brand font dialog's
 * Save, 2026-09-28) needs to know the upload is in flight. The drop zone knows (`busy`
 * from useStorageUpload); `onBusyChange` passes it on. It fires only when busy CHANGES —
 * never on mount while idle, never twice for one state — so a caller can count on it.
 *
 * The hook is mocked with a `busy` the test flips: the subject is the reporting, not the
 * upload (use-storage-upload's own tests cover busy around a real upload).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { UploadField } from '@/app/artists/[id]/(dashboard)/upload-field'

const hook = vi.hoisted(() => ({ busy: false }))
vi.mock('@/app/artists/[id]/(dashboard)/use-storage-upload', () => ({
  useStorageUpload: () => ({ busy: hook.busy, error: null, progress: null, upload: vi.fn(), reset: vi.fn() }),
}))
vi.mock('@/app/artists/[id]/(dashboard)/toast', () => ({ toast: vi.fn() }))

afterEach(() => {
  cleanup()
  hook.busy = false
})

const field = (onBusyChange: (busy: boolean) => void) => (
  <UploadField
    accept=".ttf"
    label="Upload"
    kind="font"
    bucket="fonts"
    artistId="a1"
    category="fonts"
    noun="font"
    writeRow={async () => null}
    onBusyChange={onBusyChange}
  />
)

describe('UploadField onBusyChange', () => {
  it('CRITICAL: reports true when an upload starts and false when it ends — nothing on an idle mount', () => {
    const seen = vi.fn()
    const view = render(field(seen))
    expect(seen).not.toHaveBeenCalled()
    hook.busy = true
    view.rerender(field(seen))
    expect(seen.mock.calls).toEqual([[true]])
    view.rerender(field(seen)) // still going: not said again
    expect(seen.mock.calls).toEqual([[true]])
    hook.busy = false
    view.rerender(field(seen))
    expect(seen.mock.calls).toEqual([[true], [false]])
  })
})
