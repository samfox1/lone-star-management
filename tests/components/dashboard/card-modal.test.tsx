// @vitest-environment jsdom
// The Delete footer every card grid shares, so one missing guard would be missing everywhere.
/**
 * CardModal's Delete footer — the OTHER one-click destroy path.
 *
 * Every card grid in the dashboard (releases, songs, videos, merch, tour rows) renders
 * its delete through this one footer, so a missing guard here is a missing guard in all
 * of them at once. Two rules, both learned the hard way elsewhere in this codebase:
 * a destructive action asks first, and its re-entry latch cannot be React state — two
 * fast clicks both read the pre-render value and fire twice.
 *
 * THE ASKING IS OURS NOW (Sam, 2026-09-12: "with the delete button, add a confirmation
 * modal or dialogue or something so the user can confirm before"). It used to be
 * `window.confirm`, which the browser draws in its own voice, cannot be styled, and — in
 * a page that already dims behind a card — reads as if something went wrong. The
 * question is a small dialog over the card, and the ACTION it offers is named: "Delete"
 * against a "Cancel", never the browser's OK.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { CardModal } from '@/app/artists/[id]/(dashboard)/card-modal'

vi.mock('@/app/artists/[id]/(dashboard)/toast', () => ({ toast: vi.fn() }))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function open(deleteAction: () => Promise<{ error?: string } | void>) {
  render(
    <CardModal open onClose={() => {}} deleteAction={deleteAction} deleteNoun="Release">
      <p>body</p>
    </CardModal>,
  )
  return screen.getByRole('button', { name: 'Delete' })
}

/** Open the footer's Delete and return the question's own dialog. */
function ask(action: () => Promise<{ error?: string } | void>) {
  fireEvent.click(open(action))
  return screen.getByRole('dialog', { name: /delete this release/i })
}

describe('CardModal delete', () => {
  it('CRITICAL: the footer alone deletes nothing — it asks first', () => {
    // The grids delete a release/song/video/show outright — there is no undo and no
    // trash. Asking is the only thing between a misclick and a lost row.
    const action = vi.fn(async () => {})
    const dialog = ask(action)
    expect(action).not.toHaveBeenCalled()
    expect(dialog).toHaveTextContent(/can't be undone/i)
  })

  it("CRITICAL: Cancel deletes nothing, and leaves the card open", () => {
    const action = vi.fn(async () => {})
    const dialog = ask(action)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(action).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: /delete this release/i })).toBeNull()
    expect(screen.getByText('body')).toBeInTheDocument()
  })

  it('confirming deletes', async () => {
    const action = vi.fn(async () => {})
    const dialog = ask(action)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await act(async () => {})
    expect(action).toHaveBeenCalledTimes(1)
  })

  it('two fast clicks on the footer raise ONE question and delete ONCE', async () => {
    // Both clicks go to the FOOTER's Delete, inside one act batch — a real double-click.
    //
    // The previous version of this test clicked the DIALOG's Delete twice and was named
    // for `deletingRef`. It never reached that ref: `useConfirm.settle` nulls its
    // resolver before resolving, so the second click resolved nothing regardless. The
    // ref could be deleted with the suite still green, so it has been (2026-09-12) —
    // double-firing is prevented by shape now, not by a guard. The question must be
    // answered before the delete starts, and `useConfirm` holds one question at a time
    // (pinned in confirm-dialog.test.tsx). No mutation inside CardModal can redden this;
    // it pins the end-to-end behaviour, which is the thing worth pinning.
    const action = vi.fn(async () => {})
    const footer = open(action)
    await act(async () => {
      footer.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      footer.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    const dialogs = screen.getAllByRole('dialog', { name: /delete this release/i })
    expect(dialogs).toHaveLength(1)
    await act(async () => {
      fireEvent.click(within(dialogs[0]).getByRole('button', { name: 'Delete' }))
    })
    expect(action).toHaveBeenCalledTimes(1)
  })

  it('a failed delete releases the latch so the manager can retry', async () => {
    // Without a finally the modal is permanently dead after one transient failure — the
    // footer's Delete would raise a question whose confirm could never fire again.
    const action = vi.fn(async () => ({ error: 'nope' }))
    const dialog = ask(action)
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    })
    expect(action).toHaveBeenCalledTimes(1)

    // Ask again, and answer again.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    })
    const again = screen.getByRole('dialog', { name: /delete this release/i })
    await act(async () => {
      fireEvent.click(within(again).getByRole('button', { name: 'Delete' }))
    })
    expect(action).toHaveBeenCalledTimes(2)
  })

  it('CRITICAL: the browser confirm is gone — the question is ours to draw', () => {
    const action = vi.fn(async () => {})
    const confirmSpy = vi.fn(() => true)
    vi.stubGlobal('confirm', confirmSpy)
    fireEvent.click(open(action))
    expect(confirmSpy).not.toHaveBeenCalled()
  })
})

describe('the footer pair', () => {
  it('CRITICAL: Delete and Done are the same shape, and Done reads in ink', () => {
    // Sam (2026-09-12): "put a border around the delete button just like the Done button.
    // Maybe have the done button be a little more visible, like a black text." A bare
    // red word beside a pill read as a link, not the other half of a pair.
    open(vi.fn(async () => {}))
    const del = screen.getByRole('button', { name: 'Delete' })
    const done = screen.getByRole('button', { name: 'Save' })
    for (const b of [del, done]) expect(b.className).toMatch(/\bborder\b/)
    expect(done.className).toMatch(/text-ink\b/)
    expect(del.className).toMatch(/text-accent-red\b/)
  })
})
