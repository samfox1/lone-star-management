// Does a site declare everything it styles? The audit each site runs on its own registry.
/**
 * `auditRegions` — the "does this site tell the editor everything it sets?" rule, now in
 * the package so every site can run it against its OWN registry in its own suite.
 */
import { describe, expect, it } from 'vitest'
import { auditRegions } from '../../../packages/site-bridge/src/audit'

const PALETTE = ['text-ink', 'text-ink/60', 'bg-paper']

describe('auditRegions', () => {
  it('CRITICAL: flags a colour the design wears that the palette never declares', () => {
    // skeen's icons were `text-white/80` with no white in the palette: the picker read
    // blank while the icons were plainly coloured.
    const found = auditRegions([{ key: 'socials', base: 'flex text-white/80' }], PALETTE)
    expect(found).toEqual([{ key: 'socials', problem: 'wears text-white/80, which the palette never declares' }])
  })

  it('CRITICAL: a DECLARED colour and an arbitrary hex are both fine', () => {
    // The picker recognises exactly these two. Without this half, a rule that flagged
    // everything would also "pass" the test above.
    expect(auditRegions([{ key: 'a', base: 'text-ink/60 bg-paper' }], PALETTE)).toEqual([])
    expect(auditRegions([{ key: 'b', base: 'text-[#ffffffcc]' }], PALETTE)).toEqual([])
  })

  it('CRITICAL: sizes and alignment are NOT colours', () => {
    // `text-sm` and `text-[clamp(…)]` share the prefix. Flagging them buried the real
    // findings in noise on the first run of this rule (2026-08-15).
    const base = 'text-sm text-center text-[clamp(1rem,2vw,2rem)] text-2xl'
    expect(auditRegions([{ key: 'x', base }], PALETTE)).toEqual([])
  })

  it('CRITICAL: an icon group must declare its size, colour and hover colour', () => {
    // Its controls write CSS vars the icons read, so with nothing declared every one of
    // them opens blank on a row that is plainly sized and coloured.
    const bare = auditRegions([{ key: 'socials', base: 'flex gap-4', scope: 'icons' }], PALETTE)
    expect(bare.map((f) => f.problem)).toEqual([
      'icon group declares no iconsize-[…]',
      'icon group declares no hovercolor-[…]',
      'icon group declares no icon colour',
    ])
    const full = auditRegions(
      [{ key: 'socials', base: 'flex gap-4 iconsize-[18px] text-ink/60 hovercolor-[#9c4221]', scope: 'icons' }],
      PALETTE,
    )
    expect(full).toEqual([])
  })

  it('CRITICAL: BORDERS are out of scope — no section control shows one', () => {
    // Border colour is a per-ITEM control, never a section one, so a hairline is not
    // something any picker was going to show. Flagging them put a finding on every
    // divider in every registry on the first run (2026-08-15).
    expect(auditRegions([{ key: 'bar', base: 'border-b border-2 border-ink/15 border-mystery' }], PALETTE)).toEqual([])
  })

  it('a region with no colour at all is not a finding — plenty legitimately inherit', () => {
    expect(auditRegions([{ key: 'wrap', base: 'flex items-center gap-4' }], PALETTE)).toEqual([])
  })
})
