/**
 * The bridge's TWO version numbers must agree.
 *
 * `PACKAGE_VERSION` (manifest.ts) is what a site stamps into its manifest as
 * `bridgeVersion`, and what the editor compares against its own copy to decide whether to
 * flag "republish to apply". `package.json`'s `version` is what npm actually ships. They
 * are two hand-maintained copies of one fact, and the comment above `PACKAGE_VERSION` has
 * always said KEEP IN SYNC — which is a rule that depends on someone remembering.
 *
 * They were IN SYNC when this was written (2026-09-03, both 0.33.6) — so unlike most of
 * this suite it was green on its first run, and its right to exist rests on the mutation
 * check instead: drifting PACKAGE_VERSION by one patch turns it red. It is here because
 * the rule was previously enforced by a comment asking someone to remember, and the
 * package is published by hand.
 *
 * When they do drift, a site built against the newer bridge announces the older number,
 * and the editor either flags a site that is current or stays silent about one that is
 * behind. That flag exists to stop a manager dragging a slider that does nothing, so a
 * wrong answer from it is worse than no answer.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { PACKAGE_VERSION } from '@samfox1/site-bridge/manifest'

describe('site-bridge — the two version numbers are one fact', () => {
  it('PACKAGE_VERSION equals package.json version', () => {
    const pkg = JSON.parse(
      readFileSync(new URL('../packages/site-bridge/package.json', import.meta.url), 'utf8'),
    ) as { version: string }
    expect(PACKAGE_VERSION).toBe(pkg.version)
  })

  it('is a plain semver, so the editor can compare it', () => {
    // `isBridgeOutdated` parses this. A `-next` or a `v` prefix would compare wrong rather
    // than throw, which is the failure that hides.
    expect(PACKAGE_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
