// @vitest-environment jsdom
// A row with a hover pencil opens on a click anywhere on it (Sam, 2026-10-05).
/**
 * EditRow (_ui/edit-row.tsx), as each shared row type wears it. Light tier: one test per row
 * type, the main path and the one exception:
 *   - a click on the row's own text does what its pencil does (opens it);
 *   - a click on ANOTHER control inside the row keeps its own job and opens nothing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LedgerRow } from '@/app/artists/[id]/(dashboard)/(manager-tools)/_ui/ledger'
import { RowIcon } from '@/app/artists/[id]/(dashboard)/(manager-tools)/_ui/row-icon'
import { CardField, SentenceAction } from '@/app/artists/[id]/(dashboard)/(manager-tools)/_ui/disclosure'
import { KvCells, KvField } from '@/app/artists/[id]/(dashboard)/modal-kit'

afterEach(cleanup)

describe('a row with a hover pencil opens on a click anywhere on it', () => {
  it('LedgerRow: the title opens the pencil; another control in the row does not', () => {
    const edit = vi.fn()
    const preview = vi.fn()
    render(
      <LedgerRow title="Bio" guide="Site and press kit.">
        <span>No bio yet</span>
        <RowIcon icon="eye" label="Preview" onClick={preview} />
        <RowIcon icon="edit" label="Edit the bio" onClick={edit} />
      </LedgerRow>,
    )
    fireEvent.click(screen.getByText('Bio'))
    expect(edit).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    expect(preview).toHaveBeenCalledTimes(1)
    expect(edit).toHaveBeenCalledTimes(1)
    // The pencil itself still fires once, not twice (the row hands the click on, it doesn't echo it).
    fireEvent.click(screen.getByRole('button', { name: 'Edit the bio' }))
    expect(edit).toHaveBeenCalledTimes(2)
  })

  it('LedgerRow without a pencil: a click on it does nothing', () => {
    const preview = vi.fn()
    render(
      <LedgerRow title="Domain">
        <RowIcon icon="eye" label="Preview" onClick={preview} />
      </LedgerRow>,
    )
    fireEvent.click(screen.getByText('Domain'))
    expect(preview).not.toHaveBeenCalled()
  })

  it('KvField: the label opens the value; a control beside it does not', () => {
    const open = vi.fn()
    render(<KvField label="Venue" value="Scoot Inn" onSave={vi.fn()} trailing={<button type="button" onClick={open}>Open</button>} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(open).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('textbox', { name: 'Venue' })).toBeNull()
    fireEvent.click(screen.getByText('Venue'))
    expect(screen.getByRole('textbox', { name: 'Venue' })).toHaveValue('Scoot Inn')
  })

  it('KvCells: a click on a cell’s label opens THAT cell, not the first', () => {
    const cell = (label: string, value: string) => ({ label, value, onSave: vi.fn() })
    render(<KvCells label="Where" cells={[cell('City', 'Austin'), cell('State', 'TX'), cell('Country', 'US')]} />)
    fireEvent.click(screen.getByText('State'))
    expect(screen.getByRole('textbox', { name: 'State' })).toHaveValue('TX')
    expect(screen.queryByRole('textbox', { name: 'City' })).toBeNull()
  })

  it('CardField: the line opens its pencil; a link on the line does not', () => {
    const edit = vi.fn()
    render(
      <div>
        <CardField label="What to do">
          <p>
            Write a bio <a href="#help">help</a>
            <SentenceAction icon="edit" label="Open the bio" onClick={edit} />
          </p>
        </CardField>
      </div>,
    )
    fireEvent.click(screen.getByRole('link', { name: 'help' }))
    expect(edit).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Write a bio'))
    expect(edit).toHaveBeenCalledTimes(1)
  })
})
