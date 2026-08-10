/**
 * Run Stryker over ONLY the files this branch changed — the per-change habit as one
 * command (`npm run mutation:changed`).
 *
 * The full run is ~29 minutes and belongs before a release; this one is seconds to a
 * couple of minutes, which is the difference between a check you run and a check you
 * mean to run. The survivors that matter are almost always in code you just wrote.
 *
 * WHAT IT WILL NOT DO: widen the slice. `stryker.config.json`'s `mutate` list is
 * deliberate — it holds only modules whose behaviour DB-free tests actually pin, because
 * a module covered solely by the live-DB suites reports false survivors and teaches
 * everyone to ignore the report. So this intersects "changed" with that list and SAYS SO
 * when it drops something, rather than quietly testing less than you think.
 *
 *   npm run mutation:changed              # vs the merge-base with origin/main
 *   npm run mutation:changed -- --base HEAD~3
 *   npm run mutation:changed -- --all     # ignore the diff, run the whole slice
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const argv = process.argv.slice(2)
const baseFlag = argv.indexOf('--base')
const base = baseFlag !== -1 ? argv[baseFlag + 1] : null
const runAll = argv.includes('--all')

const git = (args: string[]): string => execFileSync('git', args, { encoding: 'utf8' }).trim()

/** The commit this branch diverged from. Falls back through origin/main → main → HEAD~1
 *  so it works in a fresh clone, on a detached head, and offline. */
function mergeBase(): string {
  if (base) return base
  for (const ref of ['origin/main', 'main']) {
    try {
      return git(['merge-base', 'HEAD', ref])
    } catch {
      // try the next ref
    }
  }
  return 'HEAD~1'
}

function main() {
  const config = JSON.parse(readFileSync('stryker.config.json', 'utf8')) as { mutate: string[] }
  const slice = new Set(config.mutate)

  let targets: string[]
  if (runAll) {
    targets = [...slice]
  } else {
    const from = mergeBase()
    // Committed changes plus anything still in the working tree — the point is to check
    // what you are about to push, not only what is already recorded.
    const changed = new Set([
      ...git(['diff', '--name-only', from, 'HEAD']).split('\n'),
      ...git(['diff', '--name-only', 'HEAD']).split('\n'),
      ...git(['ls-files', '--others', '--exclude-standard']).split('\n'),
    ].filter(Boolean))

    targets = [...changed].filter((f) => slice.has(f)).sort()

    const skipped = [...changed].filter((f) => /^(src|packages|supabase)\/.*\.tsx?$/.test(f) && !slice.has(f))
    console.log(`changed since ${from.slice(0, 12)}: ${changed.size} file(s)`)
    if (skipped.length) {
      console.log(`\nNOT mutated — outside the slice in stryker.config.json:`)
      for (const f of skipped) console.log(`  ${f}`)
      console.log(`\nIf one of these is now pinned by DB-FREE tests, add it to \`mutate\` and`)
      console.log(`re-run. If it is only covered by the live-DB suites, leaving it out is right.`)
    }
  }

  if (targets.length === 0) {
    console.log('\nNothing in the mutation slice changed. Skipping.')
    return
  }

  console.log(`\nmutating ${targets.length} file(s):`)
  for (const t of targets) console.log(`  ${t}`)
  console.log()

  execFileSync('npx', ['stryker', 'run', '--mutate', targets.join(',')], { stdio: 'inherit' })
}

main()
