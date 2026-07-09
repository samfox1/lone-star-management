// @vitest-environment jsdom
/**
 * CreateModal — the shared "Add" flow (videos / merch / tour). Opens a modal, submits
 * the typed fields to the bound action, and on success closes + toasts "{kind} added";
 * a returned error surfaces inline in the modal (no toast, modal stays open).
 */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { CreateModal } from '@/app/artists/[id]/(dashboard)/create-modal'
import { Toaster } from '@/app/artists/[id]/(dashboard)/toast'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function setup(submit: (fd: FormData) => Promise<unknown>) {
  return render(
    <>
      <CreateModal
        kind="Tour date"
        title="Add date"
        fields={[{ name: 'city', placeholder: 'City', required: true }]}
        preview={() => null}
        submit={submit}
      />
      <Toaster />
    </>,
  )
}

/** Open the modal (the toolbar trigger has aria-label "Add"). */
function openModal() {
  fireEvent.click(screen.getByRole('button', { name: 'Add' }))
  return screen.getByRole('dialog')
}

describe('CreateModal', () => {
  it('submits the typed fields, toasts, refreshes, and closes on success', async () => {
    const submit = vi.fn<(fd: FormData) => Promise<unknown>>(async () => ({}))
    setup(submit)
    const dialog = openModal()

    fireEvent.change(within(dialog).getByPlaceholderText('City'), { target: { value: 'Austin' } })
    fireEvent.click(within(dialog).getByText('Add'))

    expect(await screen.findByText('Tour date added')).toBeInTheDocument()
    const fd = submit.mock.calls[0][0] as FormData
    expect(fd.get('city')).toBe('Austin')
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument() // closed
  })

  it('surfaces a returned error inline and keeps the modal open', async () => {
    const submit = vi.fn(async () => ({ error: 'City is required.' }))
    setup(submit)
    const dialog = openModal()

    fireEvent.change(within(dialog).getByPlaceholderText('City'), { target: { value: 'x' } })
    fireEvent.click(within(dialog).getByText('Add'))

    expect(await screen.findByText('City is required.')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument() // still open
    expect(screen.queryByText('Tour date added')).not.toBeInTheDocument() // no success toast
  })
})

describe('CreateModal select fields', () => {
  it('renders options and submits the chosen value', async () => {
    const submit = vi.fn<(fd: FormData) => Promise<unknown>>(async () => ({}))
    render(
      <>
        <CreateModal
          kind="Release"
          title="Add release"
          fields={[
            { name: 'title', placeholder: 'Title', required: true },
            {
              name: 'release_type',
              placeholder: 'Type',
              options: [
                { value: 'single', label: 'Single' },
                { value: 'ep', label: 'EP' },
                { value: 'album', label: 'Album' },
              ],
            },
          ]}
          preview={() => null}
          submit={submit}
        />
        <Toaster />
      </>,
    )
    const dialog = openModal()

    fireEvent.change(within(dialog).getByPlaceholderText('Title'), { target: { value: 'Demo EP' } })
    fireEvent.change(within(dialog).getByDisplayValue('Single'), { target: { value: 'ep' } })
    fireEvent.click(within(dialog).getByText('Add'))

    expect(await screen.findByText('Release added')).toBeInTheDocument()
    const fd = submit.mock.calls[0][0] as FormData
    expect(fd.get('title')).toBe('Demo EP')
    expect(fd.get('release_type')).toBe('ep')
  })
})
