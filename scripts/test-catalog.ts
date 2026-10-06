/**
 * TEST CATALOG: one readable page of every test in the tidied areas, built from the tests' own
 * headers and comments.
 *
 * Sam, 2026-09-29: "I would like to review them, and ... there should be comments explaining what
 * each one is testing, with specifications on the files." Every file in the areas below opens
 * with a spec header (the plain sentence, Code, Feature, Tier, Covers, Not here, Fixtures) and
 * every test has a `//` comment right above it (tests/README.md). This reads them and writes
 * docs/TEST_CATALOG.md, grouped by feature:
 *
 *   npm run test:catalog
 *
 * The same reader backs tests/unit/harness/test-specs.test.ts, which fails when a file here has
 * no header or a test has no comment. So the catalog shows exactly what that test checks, and a
 * gap it prints as a warning is a gap that test reports too.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** A feature: a title for the catalog, one plain line about it, and the folders or files in it. */
export type Area = { title: string; about: string; include: string[] }

/**
 * The areas that follow the standard. A path ending in `/` is a folder (every .ts / .tsx in it,
 * at any depth); anything else is one file, which must exist. Add an area here once its tests
 * have the header and comments; the meta-test then holds it to them.
 */
export const STANDARD_AREAS: Area[] = [
  {
    title: 'SEO / GEO checks: the engine',
    about: 'The checks the SEO/GEO page runs against an artist’s live site, and the page readers they stand on.',
    include: ['tests/unit/seo-tests/', 'tests/helpers/seo/'],
  },
  {
    title: 'SEO / GEO page',
    about: 'The dashboard page: its tabs, what they show, and the routes and data behind them.',
    include: ['tests/unit/manager-tools/seo/', 'tests/components/manager-tools/seo/'],
  },
  {
    title: 'Profile page',
    about: 'Who the artist is, on one page: the name, bio, type, genre, other names, the year they started and where they are based (the SEO/GEO Facts tab until 2026-10-02).',
    include: ['tests/components/manager-tools/profile/', 'tests/unit/manager-tools/profile/'],
  },
  {
    title: 'SEO / GEO saved runs (database)',
    about: 'Check runs saved in the hosted database. These talk to the live project.',
    include: ['tests/integration/seo-tests/'],
  },
  {
    title: 'SEO / GEO page (database)',
    about: 'What the SEO/GEO page keeps in the hosted database: the Profiles tab’s marks and the bios it reads. These talk to the live project.',
    include: ['tests/integration/manager-tools/seo/'],
  },
  {
    title: 'Safe fetching',
    about: 'Every time the server fetches an address someone else chose: where it may go, how much it reads, how long it waits.',
    include: ['tests/unit/safe-fetching/'],
  },
  {
    title: 'Search engines (Google and Bing)',
    about: 'Registering an artist’s site with Google and Bing, and resending its sitemap to Google after a publish.',
    include: ['tests/unit/search-engines/'],
  },
  {
    title: 'Stored logins',
    about: 'The sign-in tokens kept in the database’s locked store (Vault): each artist’s can be reached only through that artist.',
    include: ['tests/integration/shopify/shopify-secret-binding.test.ts', 'tests/integration/sync/eventbrite-vault.test.ts'],
  },
  {
    title: 'Eventbrite and YouTube sign-in',
    about: 'The “Connect with …” buttons: the sign-in trip, what it finds, and how the Connections page shows it.',
    include: [
      'tests/unit/manager-tools/connections/eventbrite-oauth.test.ts',
      'tests/unit/manager-tools/connections/eventbrite-oauth-routes.test.ts',
      'tests/unit/manager-tools/connections/connections-page-eventbrite.test.ts',
      'tests/components/manager-tools/connections/eventbrite-connect.test.tsx',
      'tests/unit/manager-tools/connections/youtube-oauth.test.ts',
      'tests/unit/manager-tools/connections/youtube-oauth-routes.test.ts',
      'tests/unit/manager-tools/connections/connections-page-youtube.test.ts',
      'tests/components/manager-tools/connections/youtube-connect.test.tsx',
    ],
  },
  {
    title: 'Identity databases (MusicBrainz, Discogs, Wikidata)',
    about: 'Connections that say who the artist is, for AI answers, and the pre-filled “create your MusicBrainz page” link.',
    include: ['tests/unit/manager-tools/connections/identity-only.test.ts', 'tests/unit/manager-tools/connections/musicbrainz-seed.test.ts'],
  },
  {
    title: 'Shows from Eventbrite',
    about: 'Reading an organizer’s events from Eventbrite and pulling them into Tour as drafts.',
    include: ['tests/unit/tour/eventbrite-events.test.ts', 'tests/unit/tour/eventbrite-sync.test.ts', 'tests/unit/tour/tour-pull.test.ts'],
  },
  {
    title: 'The test standard',
    about: 'The check that keeps every file above to the header and the comment above each test.',
    include: ['tests/unit/harness/test-specs.test.ts'],
  },
]

export type StandardFile = { path: string; area: string; kind: 'test' | 'support' }

const isTest = (path: string) => /\.test\.tsx?$/.test(path)

function walk(root: string, dir: string): string[] {
  const full = join(root, dir)
  if (!existsSync(full)) return []
  const out: string[] = []
  for (const entry of readdirSync(full, { withFileTypes: true })) {
    const rel = `${dir}${entry.name}`
    if (entry.isDirectory()) out.push(...walk(root, `${rel}/`))
    else if (/\.tsx?$/.test(entry.name)) out.push(rel)
  }
  return out
}

/** Every file in the areas, as paths relative to `root`, in catalog order. A listed file that is gone throws. */
export function standardFiles(root: string): StandardFile[] {
  const seen = new Set<string>()
  const out: StandardFile[] = []
  for (const area of STANDARD_AREAS) {
    const paths: string[] = []
    for (const inc of area.include) {
      if (inc.endsWith('/')) paths.push(...walk(root, inc))
      else if (existsSync(join(root, inc))) paths.push(inc)
      else throw new Error(`test-catalog: ${inc} is listed in STANDARD_AREAS but does not exist (moved? update the list)`)
    }
    const tests = paths.filter(isTest).sort()
    const support = paths.filter((p) => !isTest(p)).sort()
    for (const path of [...tests, ...support]) {
      if (seen.has(path)) continue
      seen.add(path)
      out.push({ path, area: area.title, kind: isTest(path) ? 'test' : 'support' })
    }
  }
  return out
}

/* ── reading one file ─────────────────────────────────────────────────────────────────── */

/** The header's fields, in the one order they appear. `Covers` is `What it provides` in a support file. */
export const FIELDS = ['Code', 'Feature', 'Tier', 'Covers', 'Not here', 'Fixtures'] as const
type Field = (typeof FIELDS)[number]
const FIELD_LINE = /^(Code|Feature|Tier|Covers|What it provides|Not here|Fixtures):(.*)$/

export type Header = {
  line: number
  sentence: string
  /** Each field's text, continuation lines joined; `Covers` holds a support file's "What it provides". */
  fields: Partial<Record<Field, string>>
  /** The fields in the order they appear (with `Covers` for "What it provides"), repeats included. */
  order: Field[]
}

export type TestEntry = { line: number; name: string; comment: string; table: boolean }

/** Lines that may sit above the header: blank ones, and tool directives (the jsdom switch, eslint). */
const ABOVE_HEADER = /^\s*$|^\/\/\s*@vitest-|^\/[/*]\s*eslint-/
/** A comment line that talks to a tool, not to the reader. */
const DIRECTIVE = /^\s*\/\/\s*(eslint-|@ts-|prettier-ignore)/
/** A test: it / test with any modifiers (.each, .skipIf(x), .only …), or a describe.each table. */
const TEST_START = /^\s*(?:it|test)(?:\.[A-Za-z]+(?:\([^()]*\))?)*\s*[(`]/
const DESCRIBE_EACH = /^\s*describe(?:\.[A-Za-z]+(?:\([^()]*\))?)*\.each\s*[(`]/

export function readHeader(text: string): { header: Header } | { problem: { line: number; message: string } } {
  const lines = text.split('\n')
  let i = 0
  while (i < lines.length && ABOVE_HEADER.test(lines[i])) i++
  if (!lines[i]?.startsWith('/**')) {
    return { problem: { line: i + 1, message: 'the file must open with the /** spec header (tests/README.md)' } }
  }
  const start = i
  const body: { text: string; line: number }[] = []
  for (; i < lines.length; i++) {
    const raw = lines[i]
    const text = raw.replace(/^\s*\/\*\*\s?/, '').replace(/\s*\*\/\s*$/, '').replace(/^\s*\*(?: |$)/, '')
    body.push({ text, line: i + 1 })
    if (raw.includes('*/')) break
  }
  let j = body.findIndex((b) => b.text.trim() !== '')
  const sentence: string[] = []
  while (j >= 0 && j < body.length && body[j].text.trim() !== '' && !FIELD_LINE.test(body[j].text)) {
    sentence.push(body[j].text.trim())
    j++
  }
  const fields: Partial<Record<Field, string>> = {}
  const order: Field[] = []
  let current: Field | null = null
  for (const b of body) {
    const m = FIELD_LINE.exec(b.text)
    if (m) {
      current = m[1] === 'What it provides' ? 'Covers' : (m[1] as Field)
      order.push(current)
      fields[current] = m[2].trim()
    } else if (current && b.text.trim() !== '' && /^\s/.test(b.text)) {
      fields[current] = `${fields[current]} ${b.text.trim()}`.trim()
    } else {
      current = null
    }
  }
  return { header: { line: start + 1, sentence: sentence.join(' '), fields, order } }
}

/** The name a test states (for the catalog, when it has no comment). Rough on purpose: a fallback. */
function nameAt(lines: string[], i: number, table: boolean): string {
  const text = lines.slice(i, i + 12).join('\n')
  const from = table ? text.search(/[)`]\s*\(\s*['"`]/) : text.search(/[(`]/)
  const m = /(['"`])((?:\\.|(?!\1)[^\\])*)\1/.exec(text.slice(Math.max(from, 0)))
  return m ? m[2] : lines[i].trim()
}

export function readTests(text: string): TestEntry[] {
  const lines = text.split('\n')
  const out: TestEntry[] = []
  lines.forEach((line, i) => {
    const describeTable = DESCRIBE_EACH.test(line)
    if (!describeTable && !TEST_START.test(line)) return
    const table = describeTable || /\.each\b/.test(line)
    let k = i - 1
    while (k >= 0 && DIRECTIVE.test(lines[k])) k--
    const comment: string[] = []
    while (k >= 0 && /^\s*\/\//.test(lines[k]) && !DIRECTIVE.test(lines[k])) {
      comment.unshift(lines[k].replace(/^\s*\/\/\s?/, '').trim())
      k--
    }
    out.push({ line: i + 1, name: nameAt(lines, i, table), comment: comment.join(' ').trim(), table })
  })
  return out
}

/** Every way `path` misses the standard, as "path:line: what is wrong". Empty means it follows it. */
export function specProblems(path: string, text: string): string[] {
  const problems: string[] = []
  const file = path.split('/').pop() ?? path
  if (/(^|-)(defects|repros)\.test\.tsx?$/.test(file)) {
    problems.push(`${path}:1: name the file after the feature it protects, not how its bugs were found (standard §3)`)
  }
  const read = readHeader(text)
  if ('problem' in read) {
    problems.push(`${path}:${read.problem.line}: ${read.problem.message}`)
  } else {
    const { header } = read
    const at = `${path}:${header.line}`
    if (!header.sentence) problems.push(`${at}: the header's first line must be the plain sentence saying what the file proves`)
    for (const f of FIELDS) {
      if (!header.order.includes(f)) problems.push(`${at}: the header has no ${f === 'Covers' ? 'Covers (or What it provides)' : f}: line`)
      else if (!header.fields[f]) problems.push(`${at}: the header's ${f}: line is empty`)
    }
    const present = FIELDS.filter((f) => header.order.includes(f))
    if (header.order.join() !== present.join()) {
      problems.push(`${at}: the header's fields are out of order (found ${header.order.join(', ')}; the order is ${FIELDS.join(', ')})`)
    }
    if (header.fields.Tier !== undefined && !/^(STRICT|LIGHT)\b/.test(header.fields.Tier)) {
      problems.push(`${at}: Tier must start with STRICT or LIGHT`)
    }
  }
  if (isTest(path)) {
    for (const t of readTests(text)) {
      if (!t.comment) problems.push(`${path}:${t.line}: this test has no // comment right above it`)
    }
  }
  return problems
}

/* ── writing the catalog ──────────────────────────────────────────────────────────────── */

const anchor = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, '')
    .trim()
    .replace(/ /g, '-')

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

export function buildCatalog(root: string): { markdown: string; files: number; tests: number; problems: string[] } {
  const files = standardFiles(root)
  const problems: string[] = []
  const sections: string[] = []
  const contents: string[] = []
  let total = 0
  let testFiles = 0
  for (const area of STANDARD_AREAS) {
    const inArea = files.filter((f) => f.area === area.title)
    if (inArea.length === 0) continue
    const parts: string[] = []
    let areaTests = 0
    for (const f of inArea) {
      const text = readFileSync(join(root, f.path), 'utf8')
      problems.push(...specProblems(f.path, text))
      const read = readHeader(text)
      const header = 'header' in read ? read.header : null
      const tests = f.kind === 'test' ? readTests(text) : []
      areaTests += tests.length
      const title = f.kind === 'test' ? `### ${f.path} · ${plural(tests.length, 'test')}` : `### ${f.path} · support file`
      const lines = [title, '', header?.sentence || '_(no header yet)_', '']
      const facts: [string, string | undefined][] =
        f.kind === 'test'
          ? [['Code', header?.fields.Code], ['Tier', header?.fields.Tier], ['Not here', header?.fields['Not here']]]
          : [['Code', header?.fields.Code], ['What it provides', header?.fields.Covers]]
      for (const [k, v] of facts) if (v) lines.push(`- **${k}:** ${v}`)
      if (tests.length) {
        lines.push('', '**Tests**', '')
        for (const t of tests) lines.push(`- ${t.comment || `_${t.name}_ (no comment yet)`}${t.table ? ' _(one per row of a table)_' : ''}`)
      }
      parts.push(lines.join('\n'))
    }
    const areaFiles = inArea.filter((f) => f.kind === 'test').length
    total += areaTests
    testFiles += areaFiles
    contents.push(`- [${area.title}](#${anchor(area.title)}) · ${plural(areaFiles, 'file')} · ${plural(areaTests, 'test')}`)
    sections.push([`## ${area.title}`, '', area.about, '', parts.join('\n\n')].join('\n'))
  }
  const markdown = [
    '# Test catalog',
    '',
    'Every test in the tidied areas, in plain words: what each file proves, which code it tests, how',
    'strictly (Tier), what it leaves to other files, and then one line per test (the comment above it).',
    '',
    '**Generated. Do not edit by hand.** Change the test file, then run `npm run test:catalog`.',
    'How the tests are organized, and the header every file opens with: [tests/README.md](../tests/README.md).',
    'A table test (`it.each`) counts once here and runs once per row.',
    '',
    `**${plural(testFiles, 'test file')} · ${plural(total, 'test')}**`,
    '',
    ...contents,
    '',
    sections.join('\n\n'),
    '',
  ].join('\n')
  return { markdown, files: testFiles, tests: total, problems }
}

if (process.argv[1]?.endsWith('test-catalog.ts')) {
  const root = process.cwd()
  const { markdown, files, tests, problems } = buildCatalog(root)
  const out = join(root, 'docs/TEST_CATALOG.md')
  writeFileSync(out, markdown)
  console.log(`wrote docs/TEST_CATALOG.md: ${plural(files, 'test file')}, ${plural(tests, 'test')}`)
  if (problems.length) {
    console.log(`\n${plural(problems.length, 'gap')} in the standard (tests/unit/harness/test-specs.test.ts fails on these):`)
    for (const p of problems) console.log(`  ${p}`)
  }
}
