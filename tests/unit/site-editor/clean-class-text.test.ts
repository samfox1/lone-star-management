// The allowlist that decides whether typed class text reaches a rendered class attribute.
/**
 * `cleanClassText` is pure, and it is the XSS refusal on the editor's style path: the
 * editor writes a region's WHOLE class string into `site_styles.class_names`, which the
 * site interpolates into a `class` attribute. A character that can END that attribute or
 * OPEN a tag is the whole bug class.
 *
 * WHY IT LIVES HERE. These assertions used to sit at the top of
 * `tests/integration/site-editor/editor-style-save.test.ts`, beside the live
 * `saveEditorStyle` half. They were the only assertions that bit on the refusal — and
 * because `tests/integration/**` is excluded from `vitest.mutation.config.ts`, they were
 * excluded from mutation testing FOREVER. Stryker would have reported every character in
 * the allowlist regex as an unwatched survivor while a real test sat two folders away.
 * Splitting them here is what makes `src/lib/site-editor/save.ts`'s entry in
 * `stryker.config.json`'s `mutate` mean anything (AGENTS.md, "Where a test goes").
 *
 * The live upsert/clear half stays in the integration file; it needs the database.
 */
import { describe, expect, it } from 'vitest'
import { cleanClassText } from '@/lib/site-editor/save'

describe('cleanClassText', () => {
  it('accepts Tailwind utilities, arbitrary values, and variants', () => {
    expect(cleanClassText('font-momo uppercase')).toBe('font-momo uppercase')
    expect(cleanClassText('  text-[clamp(3rem,12vw,11rem)]  ')).toBe('text-[clamp(3rem,12vw,11rem)]')
    expect(cleanClassText('hover:text-flash-1 sm:text-2xl !font-black')).toBe('hover:text-flash-1 sm:text-2xl !font-black')
  })

  it('CRITICAL: accepts `+` — a calc() in a real site\'s base classes', () => {
    // Sam, 2026-08-15: styling skeen's social icons answered "that setting produced
    // something the site can't use". The editor writes the region's WHOLE class string,
    // and skeen's hero rows carry `bottom-[calc(0.75rem+env(safe-area-inset-bottom))]` —
    // the `+` was not in the allowlist, so every save of those regions was refused. The
    // region could be styled in the panel and never once saved.
    expect(cleanClassText('bottom-[calc(0.75rem+env(safe-area-inset-bottom)+100lvh-100svh)]'))
      .toBe('bottom-[calc(0.75rem+env(safe-area-inset-bottom)+100lvh-100svh)]')
    // The real string, verbatim, so this test fails if the allowlist ever narrows again.
    const heroSocials =
      'absolute inset-x-0 bottom-[calc(0.75rem+env(safe-area-inset-bottom)+100lvh-100svh)] z-20 ' +
      'flex flex-wrap items-center justify-center gap-6 iconsize-[24px] px-6 ' +
      'sm:bottom-[calc(1rem+env(safe-area-inset-bottom)+100lvh-100svh)]'
    expect(cleanClassText(heroSocials)).toBe(heroSocials)
  })

  it('treats blank/whitespace as a valid clear ("" — fall back to base)', () => {
    expect(cleanClassText('')).toBe('')
    expect(cleanClassText('   ')).toBe('')
  })

  it('REJECTS (null) characters that could break out of a class attribute', () => {
    expect(cleanClassText('a"><script>')).toBeNull()
    expect(cleanClassText("x' onclick=y")).toBeNull()
    expect(cleanClassText('a{b}')).toBeNull()
    expect(cleanClassText('`x`')).toBeNull()
  })

  /**
   * One assertion per EXCLUDED character, because the refusal is a character-class regex
   * and the test above only names four of them. A mutant that widens the class (drops a
   * negation, swaps `^` for nothing) has to be caught by a string that contains exactly
   * the character it re-admits, otherwise the survivor is real.
   */
  it.each([
    ['double quote', 'text-red"x'],
    ['apostrophe', "text-red'x"],
    ['less-than', 'text-red<x'],
    ['greater-than', 'text-red>x'],
    ['backtick', 'text-red`x'],
    ['open brace', 'text-red{x'],
    ['close brace', 'text-red}x'],
    ['semicolon', 'text-red;x'],
    ['equals', 'text-red=x'],
    ['ampersand', 'text-red&x'],
    ['backslash', 'text-red\\x'],
    ['newline', 'text-red\nx'],
    ['tab', 'text-red\tx'],
  ])('REJECTS a %s', (_name, input) => {
    expect(cleanClassText(input)).toBeNull()
  })

  it('REJECTS (null) an over-long string', () => {
    expect(cleanClassText('x'.repeat(501))).toBeNull()
    expect(cleanClassText('x'.repeat(500))).toBe('x'.repeat(500))
  })

  /** The boundary the length check sits on, from both sides, so `>` cannot become `>=`. */
  it('the length limit is 500 INCLUSIVE', () => {
    expect(cleanClassText('x'.repeat(499))).toBe('x'.repeat(499))
    expect(cleanClassText('x'.repeat(500))).toBe('x'.repeat(500))
    expect(cleanClassText('x'.repeat(501))).toBeNull()
  })

  /** Trimming happens BEFORE the length check, so 500 chars of padding is not a rejection. */
  it('trims before measuring, so surrounding whitespace never trips the limit', () => {
    const padded = `   ${'x'.repeat(500)}   `
    expect(cleanClassText(padded)).toBe('x'.repeat(500))
  })
})
