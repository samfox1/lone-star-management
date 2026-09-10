// @vitest-environment jsdom
// The edit form: run the action on submit, then toast Saved or the error.
/**
 * SaveForm — client edit form behavior (no DB). Runs the bound action on submit and
 * confirms with a toast: "Saved" on success, the returned error on failure. Proves the
 * jsdom UI harness (RTL + real toast pub/sub via <Toaster/>) works end-to-end.
 */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { SaveForm } from '@/app/artists/[id]/(dashboard)/save-form'
import { Toaster } from '@/app/artists/[id]/(dashboard)/toast'

afterEach(cleanup)

/** Render a SaveForm with one text input, alongside the toast surface. */
function setup(action: (fd: FormData) => Promise<{ error?: string } | void>, props = {}) {
  return render(
    <>
      <SaveForm action={action} {...props}>
        <input name="title" defaultValue="hello" aria-label="title" />
        <button type="submit">Save</button>
      </SaveForm>
      <Toaster />
    </>,
  )
}

describe('SaveForm', () => {
  it('toasts the saved message and passes the form data to the action', async () => {
    const action = vi.fn<(fd: FormData) => Promise<{ error?: string }>>(async () => ({}))
    setup(action, { savedMessage: 'Saved' })

    fireEvent.click(screen.getByText('Save'))

    expect(await screen.findByText('Saved')).toBeInTheDocument()
    expect(action).toHaveBeenCalledTimes(1)
    const fd = action.mock.calls[0][0] as FormData
    expect(fd.get('title')).toBe('hello')
  })

  it('toasts the returned error and does NOT clear inputs', async () => {
    const action = vi.fn(async () => ({ error: 'Name is taken.' }))
    setup(action, { resetOnSuccess: true })

    fireEvent.click(screen.getByText('Save'))

    expect(await screen.findByText('Name is taken.')).toBeInTheDocument()
    expect((screen.getByLabelText('title') as HTMLInputElement).value).toBe('hello')
  })

  it('resetOnSuccess clears typed input after a successful save', async () => {
    // Faithful to the real add forms: an empty input the manager types into. reset()
    // restores the default (empty), so a typed value clears; an input with a
    // defaultValue would reset back to that default, not to "".
    const action = vi.fn(async () => ({}))
    render(
      <>
        <SaveForm action={action} resetOnSuccess>
          <input name="title" aria-label="title" />
          <button type="submit">Save</button>
        </SaveForm>
        <Toaster />
      </>,
    )
    const input = screen.getByLabelText('title') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'New track' } })
    expect(input.value).toBe('New track')

    fireEvent.click(screen.getByText('Save'))

    await screen.findByText('Saved')
    expect(input.value).toBe('')
  })

  it('latches against a double submit (the action runs once)', async () => {
    let resolve!: (v: { error?: string }) => void
    const action = vi.fn(() => new Promise<{ error?: string }>((r) => (resolve = r)))
    setup(action)

    fireEvent.click(screen.getByText('Save'))
    fireEvent.click(screen.getByText('Save')) // second click while the first is in flight
    resolve({})

    await screen.findByText('Saved')
    expect(action).toHaveBeenCalledTimes(1)
  })
})
