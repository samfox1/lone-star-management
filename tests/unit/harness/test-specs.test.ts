/**
 * Every test file in the tidied areas opens with its spec header, and every test has a one-line
 * comment saying what it checks and why.
 *
 * Code:     scripts/test-catalog.ts (STANDARD_AREAS, standardFiles, specProblems)
 * Feature:  the test standard (tests/README.md): the header and the comment above each test
 * Tier:     STRICT (AGENTS.md "Test depth"): Sam reviews the tests by reading these headers and
 *           comments (docs/TEST_CATALOG.md is built from them), so a missing one is a gap in
 *           what he can see.
 * Covers:   • every file in the areas has the header, with Code, Feature, Tier, Covers,
 *             Not here and Fixtures, in that order (support files say "What it provides")
 *           • Tier says STRICT or LIGHT
 *           • every it / test / .each has a `//` comment on the line(s) right above it
 *           • no file is named after how its bugs were found (`*-defects`, `*-repros`)
 *           • the checker itself goes red on each kind of gap (so a green run means something)
 * Not here: whether a comment is TRUE (a person reads it); the catalog's layout (it is only
 *           written, never asserted: open docs/TEST_CATALOG.md).
 * Fixtures: none faked for the real run: it reads the files on disk. The checker's own tests
 *           feed it small made-up files as strings.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { STANDARD_AREAS, standardFiles, specProblems } from '../../../scripts/test-catalog'

const ROOT = process.cwd()

/** A header with all six fields, for the checker's own tests. */
const GOOD_HEADER = [
  '/**',
  ' * The thing works.',
  ' *',
  ' * Code:     src/lib/thing.ts',
  ' * Feature:  the thing',
  ' * Tier:     STRICT (AGENTS.md "Test depth"): security',
  ' * Covers:   • it works',
  ' * Not here: nothing else',
  ' * Fixtures: none',
  ' */',
].join('\n')

const GOOD_TEST = `${GOOD_HEADER}\nimport { it } from 'vitest'\n\n// It works: or nothing does.\nit('works', () => {})\n`

describe('the checker itself', () => {
  // A file that follows the standard has no problems: otherwise every check below proves nothing.
  it('passes a file that follows the standard', () => {
    expect(specProblems('x.test.ts', GOOD_TEST)).toEqual([])
  })

  // A file with no header at all is caught, and the problem names the file and line 1.
  it('names a file with no header, at line 1', () => {
    const problems = specProblems('x.test.ts', "import { it } from 'vitest'\n// ok: ok.\nit('a', () => {})\n")
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/^x\.test\.ts:1: /)
  })

  // Each of the six fields is required: dropping any one is caught, and named.
  it.each(['Code', 'Feature', 'Tier', 'Covers', 'Not here', 'Fixtures'])('catches a header missing its %s line', (field) => {
    const text = GOOD_TEST.split('\n').filter((l) => !l.startsWith(` * ${field}:`)).join('\n')
    expect(specProblems('x.test.ts', text).join('\n')).toContain(field)
  })

  // The fields come in one fixed order, so a reader always finds each in the same place.
  it('catches fields out of order', () => {
    const text = GOOD_TEST.replace(' * Code:     src/lib/thing.ts\n * Feature:  the thing', ' * Feature:  the thing\n * Code:     src/lib/thing.ts')
    expect(specProblems('x.test.ts', text).join('\n')).toMatch(/order/)
  })

  // Tier must be one of the two AGENTS.md tiers, so "how hard is this tested" is never vague.
  it('catches a Tier that is neither STRICT nor LIGHT', () => {
    const text = GOOD_TEST.replace('Tier:     STRICT', 'Tier:     medium')
    expect(specProblems('x.test.ts', text).join('\n')).toMatch(/Tier/)
  })

  // The header's first line is the plain sentence, not a field: that sentence is what the catalog shows.
  it('catches a header whose first line is a field instead of the plain sentence', () => {
    const text = GOOD_TEST.replace(' * The thing works.\n *\n', '')
    expect(specProblems('x.test.ts', text).join('\n')).toMatch(/sentence/)
  })

  // The header must OPEN the file (only a vitest environment line may sit above it).
  it('catches code above the header, but allows the jsdom line', () => {
    expect(specProblems('x.test.ts', `const a = 1\n${GOOD_TEST}`).join('\n')).toMatch(/^x\.test\.ts:1: /)
    expect(specProblems('x.test.tsx', `// @vitest-environment jsdom\n${GOOD_TEST}`)).toEqual([])
  })

  // A test with no comment above it is caught, and the problem names its exact line.
  it('names a test with no comment above it, at its line', () => {
    const text = `${GOOD_TEST}\nit('bare', () => {})\n`
    const line = text.split('\n').findIndex((l) => l.startsWith("it('bare'")) + 1
    expect(specProblems('x.test.ts', text)).toEqual([`x.test.ts:${line}: this test has no // comment right above it`])
  })

  // "Right above" means the line above: a blank line between breaks the link between comment and test.
  it('catches a comment separated from its test by a blank line', () => {
    expect(specProblems('x.test.ts', `${GOOD_TEST}\n// Far away: yes.\n\nit('far', () => {})\n`)).toHaveLength(1)
  })

  // Every way to write a test counts: .each tables, skipIf, only, and a describe.each table.
  it.each([
    ["it.each([1])('n %s', () => {})", 'it.each'],
    ["it.skipIf(true)('n', () => {})", 'it.skipIf'],
    ["test('n', () => {})", 'test'],
    ["  it.only('n', () => {})", 'an indented it.only'],
    ["describe.each([1])('n %s', () => {})", 'describe.each'],
    ['it.each`\n  a\n  ${1}\n`(\'n\', () => {})', 'an it.each template table'],
  ])('catches an uncommented %s (%s)', (code) => {
    expect(specProblems('x.test.ts', `${GOOD_TEST}\n${code}\n`)).toHaveLength(1)
  })

  // A lint or type directive is not a comment about the test: the real comment must sit above it.
  it('looks past an eslint directive to the comment above it, and does not count the directive alone', () => {
    expect(specProblems('x.test.ts', `${GOOD_TEST}\n// Real: yes.\n// eslint-disable-next-line no-empty\nit('d', () => {})\n`)).toEqual([])
    expect(specProblems('x.test.ts', `${GOOD_TEST}\n\n// eslint-disable-next-line no-empty\nit('d', () => {})\n`)).toHaveLength(1)
  })

  // A plain describe groups tests; it needs no comment of its own.
  it('does not ask for a comment above a plain describe', () => {
    expect(specProblems('x.test.ts', `${GOOD_TEST}\ndescribe('group', () => {\n  // Inner: yes.\n  it('inner', () => {})\n})\n`)).toEqual([])
  })

  // A support file (fixtures, fakes) needs the header with "What it provides", and has no tests to comment.
  it('reads a support file header with "What it provides" in place of Covers', () => {
    const support = GOOD_HEADER.replace('Covers:  ', 'What it provides:') + '\nexport const x = 1\n'
    expect(specProblems('fixture.ts', support)).toEqual([])
    expect(specProblems('fixture.ts', 'export const x = 1\n')).toHaveLength(1)
  })

  // A file named after how its bugs were found hides which feature it protects (standard §3).
  it('catches a file named after how bugs were found', () => {
    expect(specProblems('tests/unit/a/found-defects.test.ts', GOOD_TEST).join('\n')).toMatch(/feature/)
    expect(specProblems('tests/unit/a/verifier-repros.test.ts', GOOD_TEST).join('\n')).toMatch(/feature/)
  })
})

describe('the tidied areas follow the standard', () => {
  const files = standardFiles(ROOT)

  // The area list really finds files: a glob that matched nothing would make the next test pass vacuously.
  it('finds files in every area the catalog lists', () => {
    for (const area of STANDARD_AREAS) {
      expect(files.filter((f) => f.area === area.title).length, area.title).toBeGreaterThan(0)
    }
    expect(files.some((f) => f.path === 'tests/unit/harness/test-specs.test.ts')).toBe(true)
  })

  // Every file has the header and every test its comment; a failure lists each gap as file:line.
  it('every file has the header, and every test its comment', () => {
    const problems = files.flatMap((f) => specProblems(f.path, readFileSync(`${ROOT}/${f.path}`, 'utf8')))
    expect(problems).toEqual([])
  })
})
