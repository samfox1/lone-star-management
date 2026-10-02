# Tests

How the tests are laid out, what every test file starts with, and how to review them without
reading code.

## The folder map

Tests are split first by what they touch, then by feature.

| Folder | What is in it |
|---|---|
| `tests/unit/` | Code only. No database, no network. Fast. |
| `tests/components/` | Dashboard screens, rendered in a fake browser (jsdom). No database. |
| `tests/integration/` | Talks to the HOSTED database (the live Supabase project). Run on purpose only. |
| `tests/helpers/`, `tests/fixtures/` | Shared fakes and sample data, not tests. |

Inside each, one folder per feature: `tour/`, `music/`, `site-editor/`, `manager-tools/seo/` and
so on. A few examples:

| Folder | Feature |
|---|---|
| `tests/unit/seo-tests/` | The SEO/GEO checks run against an artist's live site |
| `tests/unit/manager-tools/seo/`, `tests/components/manager-tools/seo/` | The SEO/GEO page |
| `tests/unit/safe-fetching/` | Every time the server fetches an address someone else chose |
| `tests/unit/manager-tools/connections/` | The Connections page, including the sign-in buttons |
| `tests/unit/tour/` | Tour dates, including shows pulled from Eventbrite |
| `tests/unit/harness/` | Checks on the test setup itself |

A file is named after the feature it protects (`redirects.test.ts`), never after how its bugs were
found (no `*-defects.test.ts`).

A support file (a fake, sample data) used by one feature's tests sits in that feature's folder with
a leading `_` (`tests/unit/seo-tests/_found-fixtures.ts`). One shared across features goes in
`tests/helpers/` under a plain name (`tests/helpers/seo/page-fixture.ts`). Either way, import it
through the alias (`@tests/helpers/…`, `@tests/unit/…`), never by a `./` path.

## What every test file starts with

Every file in the tidied areas opens with this header, same fields, same order:

```ts
/**
 * <What this file proves, in one plain sentence a manager could read.>
 *
 * Code:     <src file(s) under test>
 * Feature:  <the SEO test id(s) + Test-tab group, or the page / feature>
 * Tier:     STRICT | LIGHT (AGENTS.md "Test depth"): <why that tier>
 * Covers:   • <behaviour, plain words>
 *           • <…>
 * Not here: <what is tested elsewhere (give the path) or not at all, and why>
 * Fixtures: <what is faked, and how>
 */
```

A support file (a fake, sample data) has the same header, with `What it provides:` in place of
`Covers:`.

**Tier** says how hard the file tests. STRICT: security, data that can be lost, money, what the
live site receives, and anything that reads outside text. LIGHT: screens still being designed, so
one test that the main path works.

## Every test has a comment right above it

```ts
  // <What it checks>: <why it matters, in plain words>.
  it('<a name that says the behaviour>', …)
```

For a table test (`it.each`), one comment above the table, and each row's name says its case.

`tests/unit/harness/test-specs.test.ts` checks both rules for the tidied areas. It fails, naming the
file and line, when a header field is missing or out of order, or a test has no comment.

## Reviewing the tests: docs/TEST_CATALOG.md

The catalog is every test in the tidied areas on one page, built from those headers and comments.
Grouped by feature. For each file: its plain sentence, the code it tests, its tier, what it
leaves to other files, and then one line per test (the comment above it). Each file shows its
test count, and the top shows the total.

It is generated, so never edit it by hand. Change the test file, then run the command again.

## Two commands

```sh
npm run test:catalog                 # rebuild docs/TEST_CATALOG.md, and list any gaps in the standard
npx vitest run tests/unit/tour       # run one folder (any folder or single file works)
```

Never point the second one at `tests/integration/` casually: those tests write to the live
database.
