// @vitest-environment jsdom
// The one on-site check: four states, one look, and no page allowed to repaint it.
/**
 * SelectToggle (Sam, 2026-09-13: "I want the checks to be consistent across the site").
 *
 * The check IS the state — black when live, blue when checked but not yet published,
 * a red ring when live but unchecked, an empty ring when off — and the rule that makes
 * it consistent is that NO page may override the palette. The tour page used to; the
 * second test reads every call site and refuses a colour prop, so the next page that
 * tries gets a failing test instead of a second look.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SelectToggle } from '@/app/artists/[id]/(dashboard)/select-toggle'

afterEach(cleanup)

function mount(selected: boolean, onSite: boolean, onToggle = vi.fn()) {
  render(<SelectToggle selected={selected} onSite={onSite} onToggle={onToggle} label="Tour Tee" />)
  return { el: screen.getByRole('checkbox'), onToggle }
}

describe('the four states', () => {
  it('CRITICAL: live is a black filled check; a pending add is blue; a pending drop is a red ring; off is empty', () => {
    expect(mount(true, true).el).toHaveAttribute('data-state', 'live')
    expect(screen.getByRole('checkbox').className).toMatch(/\bbg-ink\b/)
    cleanup()
    expect(mount(true, false).el).toHaveAttribute('data-state', 'pending-add')
    expect(screen.getByRole('checkbox').className).toMatch(/\bbg-accent\b/)
    cleanup()
    const drop = mount(false, true).el
    expect(drop).toHaveAttribute('data-state', 'pending-drop')
    expect(drop.className).toMatch(/\bborder-accent-red\b/)
    expect(drop.querySelector('svg')).toBeNull() // unchecked: a ring, no mark
    cleanup()
    const off = mount(false, false).el
    expect(off).toHaveAttribute('data-state', 'off')
    expect(off.querySelector('svg')).toBeNull()
  })

  it('is round, and says in words what the colour means', () => {
    const { el } = mount(true, false)
    expect(el.className).toMatch(/\brounded-full\b/)
    expect(el).toHaveAccessibleName('Tour Tee — checked, publish to put on site')
  })

  it('a click toggles and never reaches the card behind it', () => {
    const outer = vi.fn()
    const onToggle = vi.fn()
    render(
      <div onClick={outer}>
        <SelectToggle selected onSite onToggle={onToggle} label="Tour Tee" />
      </div>,
    )
    fireEvent.click(screen.getByRole('checkbox'))
    expect(onToggle).toHaveBeenCalledTimes(1)
    expect(outer).not.toHaveBeenCalled()
  })
})

describe('consistency across the site', () => {
  /** Every .tsx under the dashboard, recursively. */
  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = join(dir, name)
      return statSync(full).isDirectory() ? files(full) : full.endsWith('.tsx') ? [full] : []
    })
  }

  it('CRITICAL: no page repaints the check — every call site takes the one look', () => {
    const dashboard = join(process.cwd(), 'src/app/artists/[id]/(dashboard)')
    const callers = files(dashboard).filter((f) => !f.endsWith('select-toggle.tsx') && readFileSync(f, 'utf8').includes('<SelectToggle'))
    expect(callers.length).toBeGreaterThan(3) // the rule has to be guarding something
    for (const f of callers) {
      const src = readFileSync(f, 'utf8')
      // A colour or shape class on the toggle is a second look. Layout classes are fine.
      const uses = src.match(/<SelectToggle[\s\S]*?\/>/g) ?? []
      for (const use of uses) {
        expect(use, f).not.toMatch(/liveClassName|bg-|border-accent|border-ink|rounded-/)
      }
    }
  })
})
