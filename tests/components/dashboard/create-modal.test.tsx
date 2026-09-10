// @vitest-environment jsdom
/**
 * CreateModal — the shared "Add" flow (videos / merch / tour). Opens a modal, submits
 * the typed fields to the bound action, and on success closes + toasts "{kind} added";
 * a returned error surfaces inline in the modal (no toast, modal stays open).
 */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { act, render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { CreateModal, type AddField } from '@/app/artists/[id]/(dashboard)/create-modal'
import { Toaster } from '@/app/artists/[id]/(dashboard)/toast'
import { extractUpdate } from '@/lib/content-form'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function setup(
  submit: (fd: FormData) => Promise<unknown>,
  fields: AddField[] = [{ name: 'city', placeholder: 'City', required: true }],
) {
  return render(
    <>
      <CreateModal kind="Tour date" title="Add date" fields={fields} preview={() => null} submit={submit} />
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

  it('stays submittable after a rejected save (the latch releases)', async () => {
    // A latch held on the error path would leave the modal permanently dead: the
    // manager fixes the field, clicks Add, and nothing happens ever again.
    const submit = vi
      .fn<(fd: FormData) => Promise<unknown>>()
      .mockResolvedValueOnce({ error: 'City is required.' })
      .mockResolvedValueOnce({})
    setup(submit)
    const dialog = openModal()

    fireEvent.click(within(dialog).getByText('Add'))
    await screen.findByText('City is required.')

    fireEvent.change(within(dialog).getByPlaceholderText('City'), { target: { value: 'Austin' } })
    fireEvent.click(within(dialog).getByText('Add'))

    expect(await screen.findByText('Tour date added')).toBeInTheDocument()
    expect(submit).toHaveBeenCalledTimes(2)
  })

  it('latches against a double click on Add (one row, not two)', async () => {
    // Both clicks inside ONE act batch — before React re-renders the button disabled,
    // which is exactly what a fast double-click hits. Without the latch the manager
    // gets two identical rows and has to delete one.
    let resolve!: (v: unknown) => void
    const submit = vi.fn(() => new Promise<unknown>((r) => (resolve = r)))
    setup(submit)
    const dialog = openModal()
    fireEvent.change(within(dialog).getByPlaceholderText('City'), { target: { value: 'Austin' } })
    const addButton = within(dialog).getByText('Add')

    await act(async () => {
      addButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      addButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(submit).toHaveBeenCalledTimes(1)

    resolve({})
    await screen.findByText('Tour date added')
  })
})

describe('CreateModal → extractUpdate (the posted form, end to end)', () => {
  /**
   * CreateModal builds its FormData BY HAND rather than from a real <form>, so its tag
   * encoding is a second implementation of the wire format TagInput + extractUpdate
   * already agree on (tests/tag-input.test.tsx). Asserting on the FormData alone would
   * pass against any encoding; these run the captured FormData through the REAL server
   * rule, so the two implementations have to meet.
   */
  const TAGS: AddField[] = [{ name: 'support', placeholder: 'Also performing…', kind: 'tags' }]

  /** Open the modal, add each tag via the chip field, submit, return the FormData. */
  async function posted(tags: string[]): Promise<FormData> {
    const submit = vi.fn<(fd: FormData) => Promise<unknown>>(async () => ({}))
    setup(submit, TAGS)
    const dialog = openModal()
    const box = within(dialog).getByLabelText('Also performing…')
    for (const tag of tags) {
      fireEvent.change(box, { target: { value: tag } })
      fireEvent.keyDown(box, { key: 'Enter' })
    }
    fireEvent.click(within(dialog).getByText('Add'))
    await screen.findByText('Tour date added')
    return submit.mock.calls[0][0]
  }

  it('posts one entry per tag, and the server keeps them all', async () => {
    const fd = await posted(['Arlo', 'Bo Reed'])
    expect(extractUpdate('tour_date', fd).support).toEqual(['Arlo', 'Bo Reed'])
  })

  it('keeps the field PRESENT with no tags, so the column is written as empty', async () => {
    // The blank sentinel's whole job: without it `support` is absent from the form,
    // extractUpdate skips it as untouched, and the field can never be cleared.
    const fd = await posted([])
    expect(fd.has('support')).toBe(true)
    expect(extractUpdate('tour_date', fd).support).toEqual([])
  })

  it('never lets the sentinel reach the database as a tag', async () => {
    const fd = await posted(['Arlo'])
    expect(fd.getAll('support')).toContain('') // the sentinel really is on the wire
    expect(extractUpdate('tour_date', fd).support).toEqual(['Arlo'])
  })

  it('keeps a comma inside ONE tag instead of splitting it into two', async () => {
    const fd = await posted(['Crosby, Stills & Nash'])
    expect(extractUpdate('tour_date', fd).support).toEqual(['Crosby, Stills & Nash'])
  })
})
