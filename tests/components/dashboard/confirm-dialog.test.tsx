// @vitest-environment jsdom
// The one confirmation dialog: it hands an answer back to the caller that is mid-await.
/**
 * useConfirm — what replaced `window.confirm` everywhere in the dashboard (Sam,
 * 2026-09-12). The browser's box cannot be styled, says "OK" where the question needs a
 * verb, and over an already-dimmed card reads as an error rather than a choice.
 *
 * What has to hold, because six destructive controls now depend on it:
 *   - the promise resolves TRUE only on the named action;
 *   - cancel, Escape and a click outside all resolve FALSE — every way out that is not
 *     the action is a no;
 *   - it never rejects, so `if (!(await ask(…))) return` is safe without a try/catch;
 *   - Escape does not travel on to whatever is behind it (a card listens for Escape too);
 *   - a second ask answers the first NO rather than stranding its promise.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useConfirm } from '@/app/artists/[id]/(dashboard)/confirm-dialog'

afterEach(cleanup)

/** A harness that asks on click and records what came back. */
function Harness({ onAnswer, action }: { onAnswer: (a: boolean) => void; action?: string }) {
  const { ask, dialog } = useConfirm()
  return (
    <>
      <button type="button" onClick={async () => onAnswer(await ask('Delete this release? This cannot be undone.', { action }))}>
        go
      </button>
      {dialog}
    </>
  )
}

function open(onAnswer: (a: boolean) => void, action?: string) {
  render(<Harness onAnswer={onAnswer} action={action} />)
  fireEvent.click(screen.getByRole('button', { name: 'go' }))
  return screen.getByRole('dialog')
}

describe('useConfirm', () => {
  it('CRITICAL: the named action resolves true', async () => {
    const answer = vi.fn()
    open(answer)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    })
    expect(answer).toHaveBeenCalledWith(true)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('CRITICAL: Cancel resolves false', async () => {
    const answer = vi.fn()
    open(answer)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    })
    expect(answer).toHaveBeenCalledWith(false)
  })

  it('CRITICAL: Escape resolves false, and does not travel to what is behind it', async () => {
    const answer = vi.fn()
    const behind = vi.fn()
    document.addEventListener('keydown', behind)
    try {
      open(answer)
      await act(async () => {
        fireEvent.keyDown(document, { key: 'Escape' })
      })
      expect(answer).toHaveBeenCalledWith(false)
      expect(behind, 'the card behind would have closed too').not.toHaveBeenCalled()
    } finally {
      document.removeEventListener('keydown', behind)
    }
  })

  it('a click on the backdrop resolves false; a click INSIDE does not', async () => {
    const answer = vi.fn()
    const dialog = open(answer)
    await act(async () => {
      fireEvent.mouseDown(dialog)
    })
    expect(answer).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.mouseDown(dialog.parentElement!)
    })
    expect(answer).toHaveBeenCalledWith(false)
  })

  it('the action is NAMED — never an OK that could mean either half', () => {
    open(vi.fn(), 'Remove')
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^OK$/i })).toBeNull()
  })

  it('CRITICAL: a second ask answers the first NO rather than stranding it', async () => {
    // An await that never settles is a button that never comes back.
    const answers: boolean[] = []
    function Twice() {
      const { ask, dialog } = useConfirm()
      return (
        <>
          <button type="button" onClick={async () => answers.push(await ask('first'))}>
            one
          </button>
          <button type="button" onClick={async () => answers.push(await ask('second'))}>
            two
          </button>
          {dialog}
        </>
      )
    }
    render(<Twice />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'one' }))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'two' }))
    })
    expect(answers).toEqual([false])
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    })
    expect(answers).toEqual([false, true])
  })
})
