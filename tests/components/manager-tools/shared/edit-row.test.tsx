// @vitest-environment jsdom
// A row with a hover pencil opens on a click anywhere on it (Sam, 2026-10-05).
/**
 * EditRow (_ui/edit-row.tsx), as each shared row type wears it. Light tier: one test per row
 * type, the main path and the one exception:
 *   - a click on the row's own text does what its pencil does (opens it);
 *   - a click on ANOTHER control inside the row keeps its own job and opens nothing;
 *   - a row with NO pencil hands the click to its + or upload glyph (Sam, 2026-10-05), unless
 *     the press was a click away from a field in the row;
 *   - the site editor's rows (clickedAControl) read the same control list, not a copy.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPortal } from 'react-dom'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DocumentUpload } from '@/app/artists/[id]/(dashboard)/(manager-tools)/epk/document-upload'
import { LedgerRow } from '@/app/artists/[id]/(dashboard)/(manager-tools)/_ui/ledger'
import { RowIcon } from '@/app/artists/[id]/(dashboard)/(manager-tools)/_ui/row-icon'
import { CardField, SentenceAction } from '@/app/artists/[id]/(dashboard)/(manager-tools)/_ui/disclosure'
import { KvCells, KvField } from '@/app/artists/[id]/(dashboard)/modal-kit'
import { clickedAControl } from '@/app/artists/[id]/(dashboard)/editor/inspector-shared'

// The press kit's real uploader (UploadField over a hidden file input); nothing is uploaded.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }))
vi.mock('@/app/artists/[id]/(dashboard)/(manager-tools)/epk/actions', () => ({ savePressDocumentAction: vi.fn(async () => ({})) }))
vi.mock('@/app/artists/[id]/(dashboard)/toast', () => ({ toast: vi.fn() }))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

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

describe('a row with no pencil opens its + or upload glyph on a click anywhere on it', () => {
  it('LedgerRow: the title opens the +; a pencil, when there is one, still wins', () => {
    const add = vi.fn()
    const { rerender } = render(
      <LedgerRow title="Secondary logo">
        <RowIcon icon="plus" label="Add logo" variant="primary" onClick={add} />
      </LedgerRow>,
    )
    fireEvent.click(screen.getByText('Secondary logo'))
    expect(add).toHaveBeenCalledTimes(1)
    const edit = vi.fn()
    rerender(
      <LedgerRow title="Secondary logo">
        <RowIcon icon="plus" label="Add logo" variant="primary" onClick={add} />
        <RowIcon icon="edit" label="Edit" onClick={edit} />
      </LedgerRow>,
    )
    fireEvent.click(screen.getByText('Secondary logo'))
    expect(edit).toHaveBeenCalledTimes(1)
    expect(add).toHaveBeenCalledTimes(1)
  })

  it('a press while a field in the row is focused is a click away from it, not an add', () => {
    const add = vi.fn()
    render(
      <LedgerRow title="Genre">
        <input aria-label="Genre" />
        <RowIcon icon="plus" label="Add genre" variant="primary" onClick={add} />
      </LedgerRow>,
    )
    screen.getByRole('textbox', { name: 'Genre' }).focus()
    fireEvent.mouseDown(screen.getByText('Genre'))
    fireEvent.click(screen.getByText('Genre'))
    expect(add).not.toHaveBeenCalled()
    // The next press, with nothing being typed in, adds.
    screen.getByRole('textbox', { name: 'Genre' }).blur()
    fireEvent.mouseDown(screen.getByText('Genre'))
    fireEvent.click(screen.getByText('Genre'))
    expect(add).toHaveBeenCalledTimes(1)
  })

  // An inline panel's blank space is the panel's: a click there must not re-click the row's +.
  it('a click on blank space inside an open inline panel (the Brand colour palette) is the panel’s own', () => {
    // An empty colour row opens its palette inline, inside the row, with focus left on the +. A
    // click on the panel's padding or its "On the site" caption clicked the + again, which closed
    // the panel before a colour was picked.
    const add = vi.fn()
    render(
      <LedgerRow title="Primary">
        <RowIcon icon="plus" label="Add color" variant="primary" onClick={add} />
        <div role="dialog" aria-label="Palette">
          <p>On the site</p>
        </div>
      </LedgerRow>,
    )
    screen.getByRole('button', { name: 'Add color' }).focus()
    fireEvent.mouseDown(screen.getByText('On the site'))
    fireEvent.click(screen.getByText('On the site'))
    expect(add).not.toHaveBeenCalled()
  })

  it('the press kit: a click on an empty document row opens the file picker', () => {
    const pick = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    render(<DocumentUpload artistId="a1" kind="tech_rider" label="Tech rider" hint="" present={false} />)
    fireEvent.click(screen.getByText('Tech rider'))
    expect(pick).toHaveBeenCalledTimes(1)
    expect((pick.mock.contexts[0] as HTMLInputElement).type).toBe('file')
  })
})

describe('the site editor reads the same rule', () => {
  // One list of what counts as a control: the editor's own copy had drifted (no menus, no panels, no portal guard).
  it('clickedAControl: a menu, an inline panel and a portal opened from the row are not the row', () => {
    const open = vi.fn()
    function Row() {
      return (
        <div onClick={(e) => !clickedAControl(e) && open()}>
          <span>Venue</span>
          <div role="listbox" aria-label="Pick">
            <span>Between options</span>
          </div>
          <div role="dialog" aria-label="Panel">
            <p>Panel padding</p>
          </div>
          {createPortal(<p>In a portal</p>, document.body)}
        </div>
      )
    }
    render(<Row />)
    fireEvent.click(screen.getByText('Between options'))
    fireEvent.click(screen.getByText('Panel padding'))
    fireEvent.click(screen.getByText('In a portal'))
    expect(open).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Venue'))
    expect(open).toHaveBeenCalledTimes(1)
  })
})
