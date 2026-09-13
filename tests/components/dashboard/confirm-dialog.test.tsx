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
 *   - a second ask answers the first NO rather than stranding its promise;
 *   - focus starts on the SAFE answer and goes back to whoever asked.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useConfirm, type ConfirmTone } from '@/app/artists/[id]/(dashboard)/confirm-dialog'

afterEach(cleanup)

/** A harness that asks on click and records what came back. */
function Harness({ onAnswer, action, tone }: { onAnswer: (a: boolean) => void; action?: string; tone?: ConfirmTone }) {
  const { ask, dialog } = useConfirm()
  return (
    <>
      <button type="button" onClick={async () => onAnswer(await ask('Delete this release? This cannot be undone.', { action, tone }))}>
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

describe('the question takes focus, and gives it back', () => {
  it('CRITICAL: focus starts on Cancel, not on the destructive answer', () => {
    // A question that opens with Delete focused turns a stray Enter — one already on its
    // way when the dialog appeared — into a deletion. The safe answer holds focus.
    const dialog = open(() => {})
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancel' }))
  })

  it('hands focus back to whoever asked', async () => {
    // Otherwise focus is left on a button that no longer exists and the next Tab starts
    // from the top of the document — the manager loses their place in the card.
    render(<Harness onAnswer={() => {}} />)
    const trigger = screen.getByRole('button', { name: 'go' })
    trigger.focus()
    fireEvent.click(trigger)
    await act(async () => {
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    })
    expect(document.activeElement).toBe(trigger)
  })

  it('a re-ask still returns focus to the original opener, not to the old dialog', async () => {
    // The second `ask` fires while the question is up, so the active element is the
    // dialog's own button. Recording THAT as the opener would hand focus to a detached
    // node — which is where focus silently becomes document.body.
    function Twice() {
      const { ask, dialog } = useConfirm()
      return (
        <>
          <button type="button" onClick={() => void ask('first?')}>
            go
          </button>
          <button type="button" onClick={() => void ask('second?')}>
            again
          </button>
          {dialog}
        </>
      )
    }
    render(<Twice />)
    const trigger = screen.getByRole('button', { name: 'go' })
    trigger.focus()
    fireEvent.click(trigger)
    // The question is now UP and holding focus on its Cancel — which is the whole point:
    // the second ask must not mistake that for the opener.
    expect(document.activeElement).toBe(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'again' }))
    })
    await act(async () => {
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    })
    expect(document.activeElement).toBe(trigger)
  })
})

describe('the answer button wears the tone it was asked for', () => {
  it('is red by default, because the callers are destructive', () => {
    const dialog = open(() => {})
    expect(within(dialog).getByRole('button', { name: 'Delete' }).className).toMatch(/text-accent-red/)
  })

  it('an affirmative action is NOT drawn as a destruction', () => {
    // ActionButton's `confirm` asks about publishing, which is not a deletion and must
    // not be painted like one.
    render(<Harness onAnswer={() => {}} action="Continue" tone="solid" />)
    fireEvent.click(screen.getByRole('button', { name: 'go' }))
    const go = within(screen.getByRole('dialog')).getByRole('button', { name: 'Continue' })
    expect(go.className).not.toMatch(/text-accent-red/)
  })
})
