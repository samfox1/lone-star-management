/**
 * tokens.css IS IN SYNC WITH THE EDITOR'S VOCABULARY (SITE_BRIDGE_PLAN.md phase 1).
 *
 * The committed file is what deployed sites compile; the generator derives it from the
 * editor's live control definitions. This suite regenerates in memory and diffs — so
 * adding a control option without running `npm run tokens` is a red build here, not a
 * manager staring at a slider that moves while the page does not (2026-08-05, three
 * times; skeen's three missing weights, found 2026-08-07).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildTokensCss, classVocabulary } from '../../../scripts/generate-bridge-tokens'
import { TEXT_SIZES } from '@samfox1/site-bridge/styles'

const committed = () =>
  readFileSync(join(process.cwd(), 'packages/site-bridge/tokens.css'), 'utf8')

describe('the generated token sheet', () => {
  it('CRITICAL: the committed file matches a fresh generation', () => {
    expect(committed()).toBe(buildTokensCss())
  })

  it('CRITICAL: covers the full size ladder and all nine weights', () => {
    // The two vocabularies with drift HISTORY: the ladder (the 2026-08-05 bug) and the
    // weights (skeen compiled six of nine until 2026-08-07). Membership pinned here so
    // a generator regression cannot silently shrink either family.
    const vocab = new Set(classVocabulary())
    for (const s of TEXT_SIZES) expect(vocab, s.value).toContain(s.value)
    for (const w of ['thin', 'extralight', 'light', 'normal', 'medium', 'semibold', 'bold', 'extrabold', 'black'])
      expect(vocab, w).toContain(`font-${w}`)
  })

  it('lifted tokens are EXCLUDED — inline style needs no CSS', () => {
    // The generator filters through the package's own resolveStyle; these families
    // apply as inline style and safelisting them would just bloat every site's build.
    const vocab = classVocabulary()
    expect(vocab.some((t) => /^scale-\d/.test(t))).toBe(false)
    expect(vocab.some((t) => /^opacity-\d/.test(t))).toBe(false)
    expect(vocab.some((t) => t.startsWith('shadow'))).toBe(false)
    expect(vocab.some((t) => /^speed-/.test(t))).toBe(false)
  })
})

describe('the append-only ratchet (P5) — enforcement, not documentation', () => {
  const BASELINE = join(process.cwd(), 'tests/fixtures/bridge-token-baseline.json')

  it('CRITICAL: no token ever shipped may leave the sheet', () => {
    // The 2026-08-07 review confirmed the FOREVER rule had no teeth: remove a control
    // option, regenerate, and the file and generator shrank in lockstep, suite green.
    // The committed baseline is a union the generator only grows — a removal leaves the
    // token here, this test goes red, and only a hand edit can silence it.
    const baseline: string[] = JSON.parse(readFileSync(BASELINE, 'utf8'))
    const current = new Set(classVocabulary())
    expect(
      baseline.filter((t) => !current.has(t)),
      'removed tokens orphan stored styles on every deployed site at its next build',
    ).toEqual([])
  })

  it('new tokens are recorded in the baseline, so THEIR future removal is caught', () => {
    const baseline = new Set<string>(JSON.parse(readFileSync(BASELINE, 'utf8')))
    expect(
      classVocabulary().filter((t) => !baseline.has(t)),
      'run npm run tokens to append these to the baseline',
    ).toEqual([])
  })
})
