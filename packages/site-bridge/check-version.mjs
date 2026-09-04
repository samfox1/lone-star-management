/**
 * Refuse to publish when the package's two version numbers disagree.
 *
 * `PACKAGE_VERSION` (src/manifest.ts) is what a site stamps into its manifest and what
 * the editor compares to decide whether to flag "republish to apply"; package.json's
 * `version` is what npm ships. Two hand-maintained copies of one fact, in a package
 * published by hand — `tests/site-bridge-version.test.ts` catches a drift on the next
 * test run, which is AFTER a wrong number could already be on the registry. This runs at
 * the only moment that is too late to be wrong.
 *
 * A separate file rather than an inline `-e` one-liner because a quoting mistake in a
 * prepublish hook fails open, and a guard that fails open is not one.
 */
import { readFileSync } from 'node:fs'

const dir = new URL('./', import.meta.url)
const pkg = JSON.parse(readFileSync(new URL('package.json', dir), 'utf8'))
const src = readFileSync(new URL('src/manifest.ts', dir), 'utf8')

const found = src.match(/export const PACKAGE_VERSION = '([^']+)'/)
if (!found) {
  console.error('check-version: PACKAGE_VERSION not found in src/manifest.ts')
  process.exit(1)
}
if (found[1] !== pkg.version) {
  console.error(
    `check-version: package.json is ${pkg.version} but PACKAGE_VERSION is ${found[1]}.\n` +
      'Set them to the same value before publishing.',
  )
  process.exit(1)
}
console.log(`check-version: ${pkg.version} ✓`)
