// @vitest-environment jsdom
// The chip field for who else is on a tour date, checked against what a real form would post.
/**
 * TagInput — the chip field behind a tour date's "who else is performing".
 *
 * The last block is the one that matters: it renders the field in a REAL <form>,
 * takes the FormData the browser would actually post, and runs it through the REAL
 * extractUpdate. The component and the server rule have to meet, and they meet over
 * a blank sentinel entry that is invisible in both files on its own — testing either
 * half alone would let a cleared list silently stop saving.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { TagInput } from '@/app/artists/[id]/(dashboard)/tag-input'
import { extractUpdate } from '@/lib/content-form'

afterEach(cleanup)

const box = () => screen.getByLabelText('Also performing…')

function type(text: string) {
  fireEvent.change(box(), { target: { value: text } })
}
function enter() {
  fireEvent.keyDown(box(), { key: 'Enter' })
}

describe('TagInput', () => {
  it('shows the tags it was seeded with', () => {
    render(<TagInput name="support" defaultValue={['Arlo', 'Bo Reed']} placeholder="Also performing…" />)
    expect(screen.getByText('Arlo')).toBeDefined()
    expect(screen.getByText('Bo Reed')).toBeDefined()
  })

  it('commits a tag on Enter and clears the box', () => {
    render(<TagInput name="support" placeholder="Also performing…" />)
    type('Arlo')
    enter()
    expect(screen.getByText('Arlo')).toBeDefined()
    expect((box() as HTMLInputElement).value).toBe('')
  })

  it('keeps a comma inside ONE tag instead of splitting on it', () => {
    // The reason this component exists rather than a comma-split text input: plenty
    // of acts have a comma in the name, and this must be one act, not three.
    render(<TagInput name="support" placeholder="Also performing…" />)
    type('Crosby, Stills & Nash')
    enter()
    expect(screen.getByText('Crosby, Stills & Nash')).toBeDefined()
    expect(screen.queryByText('Stills')).toBeNull()
  })

  it('commits on blur, so a typed name is not lost by clicking Save', () => {
    render(<TagInput name="support" placeholder="Also performing…" />)
    type('Arlo')
    fireEvent.blur(box())
    expect(screen.getByText('Arlo')).toBeDefined()
  })

  it('ignores a blank or duplicate tag', () => {
    render(<TagInput name="support" defaultValue={['Arlo']} placeholder="Also performing…" />)
    type('   ')
    enter()
    type('Arlo')
    enter()
    expect(screen.getAllByText('Arlo')).toHaveLength(1)
  })

  it('removes a tag from its chip', () => {
    render(<TagInput name="support" defaultValue={['Arlo', 'Bo Reed']} placeholder="Also performing…" />)
    fireEvent.click(screen.getByLabelText('Remove Arlo'))
    expect(screen.queryByText('Arlo')).toBeNull()
    expect(screen.getByText('Bo Reed')).toBeDefined()
  })

  it('backspaces the last tag from an empty box, but not while typing', () => {
    render(<TagInput name="support" defaultValue={['Arlo', 'Bo Reed']} placeholder="Also performing…" />)
    type('Cas')
    fireEvent.keyDown(box(), { key: 'Backspace' })
    expect(screen.getByText('Bo Reed')).toBeDefined() // still mid-word — don't eat a chip
    type('')
    fireEvent.keyDown(box(), { key: 'Backspace' })
    expect(screen.queryByText('Bo Reed')).toBeNull()
  })
})

describe('TagInput → extractUpdate (the posted form, end to end)', () => {
  /** The FormData a real submit would carry, straight out of the rendered <form>. */
  function posted(ui: React.ReactElement): FormData {
    const { container } = render(<form>{ui}</form>)
    return new FormData(container.querySelector('form') as HTMLFormElement)
  }

  it('posts one entry per tag, and the server keeps them all', () => {
    const fd = posted(<TagInput name="support" defaultValue={['Arlo', 'Bo Reed']} placeholder="Also performing…" />)
    expect(extractUpdate('tour_date', fd).support).toEqual(['Arlo', 'Bo Reed'])
  })

  it('CLEARS the column when the manager removes every tag', () => {
    // The sentinel's whole job. Without it the form posts no `support` key at all,
    // extractUpdate skips the field as "untouched", and the last supporting act can
    // never be removed — the site would keep showing it after every save.
    render(
      <form>
        <TagInput name="support" defaultValue={['Arlo']} placeholder="Also performing…" />
      </form>,
    )
    fireEvent.click(screen.getByLabelText('Remove Arlo'))
    const form = document.querySelector('form') as HTMLFormElement
    const fd = new FormData(form)

    expect(fd.has('support')).toBe(true) // present, though there are no tags
    expect(extractUpdate('tour_date', fd).support).toEqual([])
  })

  it('never lets the sentinel reach the database as a tag', () => {
    const fd = posted(<TagInput name="support" defaultValue={['Arlo']} placeholder="Also performing…" />)
    expect(fd.getAll('support')).toContain('') // the sentinel really is on the wire
    expect(extractUpdate('tour_date', fd).support).toEqual(['Arlo']) // and the server drops it
  })
})
