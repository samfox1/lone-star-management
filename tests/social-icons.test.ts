/**
 * EVERY OFFERED PLATFORM HAS A MARK, AND THE COMMITTED FILE IS THE GENERATED ONE.
 *
 * The picker draws from `SOCIAL_PLATFORMS`; the marks live in a GENERATED file beside
 * it. Nothing at runtime notices when the two disagree — a platform added to the
 * registry without regenerating simply renders with no icon, which reads as a styling
 * bug rather than a missing build step. Same shape as the tokens.css drift guard.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildSocialIcons } from '../scripts/generate-social-icons'
import { SOCIAL_PLATFORMS, socialPlatform, socialSlug } from '@samfox1/site-bridge/social'
import { SOCIAL_ICONS, socialIcon } from '@samfox1/site-bridge/social-icons'

const committed = () => readFileSync(join(process.cwd(), 'packages/site-bridge/src/social-icons.ts'), 'utf8')

describe('the generated social marks', () => {
  it('CRITICAL: the committed file matches a fresh generation', () => {
    expect(committed()).toBe(buildSocialIcons())
  })

  it('CRITICAL: every offered platform has a mark — derived, never hand-listed', () => {
    // AGENTS.md rule 4: iterate the REGISTRY, so a platform added tomorrow is covered by
    // this test the moment it exists rather than the day someone remembers to list it.
    for (const p of SOCIAL_PLATFORMS) {
      const icon = socialIcon(p.slug)
      expect(icon, p.slug).not.toBeNull()
      expect(icon!.path.length, p.slug).toBeGreaterThan(20)
      expect(icon!.hex, p.slug).toMatch(/^#[0-9A-Fa-f]{6}$/)
    }
  })

  it('carries no marks for platforms it does not offer', () => {
    // The mirror of the rule above: an orphan mark means a platform was REMOVED from the
    // registry, which orphans every link row already labelled with it.
    expect(Object.keys(SOCIAL_ICONS).sort()).toEqual(SOCIAL_PLATFORMS.map((p) => p.slug).sort())
  })

  it('an unknown platform has no mark, and that is a supported state', () => {
    // "Something else" is a first-class path — an artist always has somewhere we have not
    // heard of, and it must render as a plain labelled link rather than a broken icon.
    expect(socialIcon('some-zine-nobody-has-heard-of')).toBeNull()
    expect(socialPlatform('Some Zine')).toBeNull()
  })

  it('slugs are the label lowercased — the join the item markers already use', () => {
    // A site posts `item:link:apple music` from its rendered label. If the registry
    // slugged differently (hyphenating, stripping spaces), the picker would write a
    // label the site could never match back.
    for (const p of SOCIAL_PLATFORMS) expect(socialSlug(p.label)).toBe(p.slug)
  })
})
