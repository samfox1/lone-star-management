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
import { buildTokensCss, classVocabulary } from '../scripts/generate-bridge-tokens'
import { TEXT_SIZES } from '@lone-star/site-bridge/styles'

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
