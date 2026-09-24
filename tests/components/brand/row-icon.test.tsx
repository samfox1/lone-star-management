// @vitest-environment jsdom
// Brand row actions are icons with a small dark hover label (Sam, 2026-09-23).
/**
 * RowIcon. What has to hold:
 *   - the label IS the accessible name, and the visible chip carries the same words once
 *     (aria-hidden, so a screen reader does not hear it twice);
 *   - the chip opens below by default and ABOVE with labelSide="top" (bottom of a modal);
 *   - `faint` is dimmed until its row is hovered or it is focused; `primary` is full ink
 *     with a blue focus ring; a disabled control neither fires nor shows its label;
 *   - `href` renders a real link (the brand-kit download), never a button.
 * jsdom does no layout or hover, so positions and opacity are pinned as the mechanism.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { RowIcon, type RowIconVariant } from '@/app/artists/[id]/(dashboard)/brand/_ui/row-icon'
import { Icon } from '@/components/ui/icons'

afterEach(cleanup)

/** The portaled chip currently shown, if any — it lives in document.body, never in the control. */
const shownChip = () => document.body.querySelector('[data-hover-label]') as HTMLElement | null
/** The zero-size marker a HoverLabel leaves inside its control: preferred side + align. */
const marker = (el: HTMLElement) => el.querySelector(':scope > [data-side]') as HTMLElement

describe('RowIcon', () => {
  it('names the control by its label; the chip carries the same words, OUTSIDE the control', () => {
    const onClick = vi.fn()
    render(<RowIcon icon="edit" label="Edit" onClick={onClick} />)
    const btn = screen.getByRole('button', { name: 'Edit' })
    expect(btn.getAttribute('aria-label')).toBe('Edit')
    // Nothing to read inside the button: the name is aria-label, the chip is portaled.
    expect(btn.textContent).toBe('')
    fireEvent.pointerEnter(btn)
    const c = shownChip()!
    expect(c.textContent).toBe('Edit')
    expect(c.getAttribute('aria-hidden')).toBe('true')
    expect(btn.contains(c)).toBe(false)
    fireEvent.click(btn)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('carries its preferred side and alignment on the marker inside the control', () => {
    render(
      <>
        <RowIcon icon="plus" label="Below" />
        <RowIcon icon="plus" label="Above" labelSide="top" labelAlign="end" />
      </>,
    )
    const below = marker(screen.getByRole('button', { name: 'Below' }))
    expect(below.getAttribute('data-side')).toBe('bottom')
    expect(below.getAttribute('data-align')).toBe('center')
    const above = marker(screen.getByRole('button', { name: 'Above' }))
    expect(above.getAttribute('data-side')).toBe('top')
    expect(above.getAttribute('data-align')).toBe('end')
  })

  it('a disabled control does not fire and shows no label', () => {
    const onClick = vi.fn()
    render(<RowIcon icon="trash" label="Remove" variant="boxed" disabled onClick={onClick} />)
    const btn = screen.getByRole('button', { name: 'Remove' })
    expect(btn).toBeDisabled()
    fireEvent.click(btn)
    expect(onClick).not.toHaveBeenCalled()
    fireEvent.pointerEnter(btn)
    expect(shownChip()).toBeNull()
  })

  it('faint is dimmed until the ROW is hovered or it is focused', () => {
    render(<RowIcon icon="trash" label="Remove" variant="faint" />)
    const cls = screen.getByRole('button', { name: 'Remove' }).className
    expect(cls).toMatch(/(^|\s)opacity-40(\s|$)/)
    // The row group ledger.tsx sets — pinned by name so a rename on either side is red.
    expect(cls).toContain('group-hover/ledger:opacity-100')
    expect(cls).toContain('focus-visible:opacity-100')
  })

  it('primary is full ink, never dimmed, with a blue focus ring', () => {
    render(<RowIcon icon="plus" label="Add logo" variant="primary" />)
    const cls = screen.getByRole('button', { name: 'Add logo' }).className
    expect(cls).toMatch(/(^|\s)text-ink(\s|$)/)
    expect(cls).not.toMatch(/(^|\s)opacity-40(\s|$)/)
    expect(cls).toContain('focus-visible:outline-accent')
  })

  it('tones colour the hover: ✓ accent, × and trash red', () => {
    render(
      <>
        <RowIcon icon="check" label="Add" variant="boxed" size="sm" tone="accent" />
        <RowIcon icon="close" label="Cancel" variant="boxed" size="sm" tone="danger" />
      </>,
    )
    expect(screen.getByRole('button', { name: 'Add' }).className).toContain('hover:text-accent')
    expect(screen.getByRole('button', { name: 'Cancel' }).className).toContain('hover:text-accent-red')
  })

  it('with href it is a real link, not a button', () => {
    render(<RowIcon icon="download" label="Download brand kit" href="/artists/a1/brand/kit" variant="boxed" size="sm" />)
    const link = screen.getByRole('link', { name: 'Download brand kit' })
    expect(link.tagName).toBe('A')
    expect(link.getAttribute('href')).toBe('/artists/a1/brand/kit')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('forwards its ref to the button, so a note can hand focus to it', () => {
    const ref = { current: null as HTMLButtonElement | null }
    render(<RowIcon icon="plus" label="Add font" variant="primary" ref={ref} />)
    expect(ref.current).toBe(screen.getByRole('button', { name: 'Add font' }))
  })
})

describe('every + turns blue on hover and keyboard focus (Sam, 2026-09-23, said more than once)', () => {
  // The trash turns red on hover; the + (Upload new, Add logo / font / color, the empty
  // row's +, the editors' +) turns ACCENT. Once, in RowIcon: `icon="plus"` defaults to the
  // accent tone, and the accent tone colours the glyph on hover AND focus-visible.
  /** Every variant, as a Record so a new variant is a compile error here until listed. */
  const VARIANTS: Record<RowIconVariant, true> = { faint: true, primary: true, boxed: true }

  it('CRITICAL: a plus in EVERY variant is accent on hover and on keyboard focus, with no tone given', () => {
    for (const variant of Object.keys(VARIANTS) as RowIconVariant[]) {
      render(<RowIcon icon="plus" label="Add logo" variant={variant} />)
      const cls = screen.getByRole('button', { name: 'Add logo' }).className.split(/\s+/)
      expect(cls, variant).toContain('hover:text-accent')
      expect(cls, variant).toContain('focus-visible:text-accent')
      // Not also told to go black on hover — the default tone's class would fight it.
      expect(cls, variant).not.toContain('hover:text-ink')
      cleanup()
    }
  })

  it('the empty row\'s + stays full ink at rest', () => {
    render(<RowIcon icon="plus" label="Add font" variant="primary" />)
    expect(screen.getByRole('button', { name: 'Add font' }).className.split(/\s+/)).toContain('text-ink')
  })

  it('an explicit tone still wins, and other glyphs keep the default', () => {
    render(
      <>
        <RowIcon icon="plus" label="Plus, told" tone="danger" />
        <RowIcon icon="edit" label="Edit" />
      </>,
    )
    const told = screen.getByRole('button', { name: 'Plus, told' }).className.split(/\s+/)
    expect(told).toContain('hover:text-accent-red')
    expect(told).not.toContain('hover:text-accent')
    const edit = screen.getByRole('button', { name: 'Edit' }).className.split(/\s+/)
    expect(edit).toContain('hover:text-ink')
    expect(edit).not.toContain('hover:text-accent')
  })

  it('CRITICAL: no Brand call site opts a + out of the accent', () => {
    // An explicit tone wins by design, so one `tone="default"` on a + would quietly undo
    // Sam's rule at that call site. Read every RowIcon in brand/** off the source.
    const root = join(process.cwd(), 'src/app/artists/[id]/(dashboard)/brand')
    const files: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name)
        if (statSync(full).isDirectory()) walk(full)
        else if (full.endsWith('.tsx')) files.push(full)
      }
    }
    walk(root)
    let plusSites = 0
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      for (let i = src.indexOf('<RowIcon'); i !== -1; i = src.indexOf('<RowIcon', i + 1)) {
        // The JSX tag up to its `/>` or `>`, skipping anything inside {…} (arrows have `>`).
        let depth = 0
        let j = i
        for (; j < src.length; j++) {
          const ch = src[j]
          if (ch === '{') depth++
          else if (ch === '}') depth--
          else if (depth === 0 && ch === '>') break
        }
        const tag = src.slice(i, j + 1)
        if (!/icon=(?:"plus"|\{[^}]*'plus'[^}]*\})/.test(tag)) continue
        plusSites++
        const tone = /\btone=(?:"([^"]*)"|\{([^}]*)\})/.exec(tag)
        expect(tone === null || tone[1] === 'accent', `${file.slice(root.length)}: ${tag.replace(/\s+/g, ' ')}`).toBe(true)
      }
    }
    // The scan found the +s it is guarding (logos, colors, fonts, icons, the editors).
    expect(plusSites).toBeGreaterThanOrEqual(5)
  })
})

describe('the Brand glyphs draw something', () => {
  it('CRITICAL: chevronsUpDown and eraser are real glyphs, not empty svgs', () => {
    // A name missing from PATHS renders an empty <svg> with no error at all.
    for (const name of ['chevronsUpDown', 'eraser'] as const) {
      const { container, unmount } = render(<Icon name={name} />)
      expect(container.querySelector('svg')!.children.length, name).toBeGreaterThan(0)
      unmount()
    }
  })
})
