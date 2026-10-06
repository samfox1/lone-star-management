// @vitest-environment jsdom
/**
 * Settings · General: two ledger rows of plain text, and no email row.
 *
 * Code:     src/app/artists/[id]/(dashboard)/(manager-tools)/settings/settings-view.tsx
 * Feature:  Settings · General (2026-09-13; Brand's ledger since Batch 3, 2026-10-02)
 * Tier:     LIGHT (AGENTS.md "Test depth"): a screen still being designed, so one test of what
 *           it shows.
 * Covers:   • Site and Address are text, not controls: no input, no pencil, nothing to click
 *           • there is NO email here any more (Sam, 2026-10-02: "Remove email from General"):
 *             Settings › Email is the one place addresses are managed, so two screens can never
 *             disagree about them
 * Not here: which rows there are and how an address reads (tests/unit/manager-tools/settings/
 *           settings.test.ts).
 * Fixtures: two made-up rows.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { SettingsView } from '@/app/artists/[id]/(dashboard)/(manager-tools)/settings/settings-view'
import type { SettingsRow } from '@/lib/settings'

afterEach(cleanup)

const ROWS: SettingsRow[] = [
  { key: 'site', label: 'Site', value: 'skeenmusic.com' },
  { key: 'address', label: 'Address', value: 'lonestar.site/skeen' },
]

describe('Settings · General', () => {
  // Read-only text, and no email row to disagree with Settings › Email.
  it('shows Site and Address as text, with nothing to type into or click, and no email row', () => {
    render(<SettingsView rows={ROWS} />)
    expect(screen.getByText('skeenmusic.com')).toBeInTheDocument()
    expect(screen.getByText('lonestar.site/skeen')).toBeInTheDocument()
    expect(screen.queryAllByRole('textbox')).toEqual([])
    expect(screen.queryAllByRole('button')).toEqual([])
    expect(screen.queryByText(/email/i)).toBeNull()
  })
})
