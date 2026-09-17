/**
 * TEMPORARY (2026-09-17) — delete with the panel it feeds.
 *
 * The gate on the PostHog cross-check panel at the bottom of the artist dashboard. The
 * comparison runs for ONE artist and reads PostHog with a PERSONAL API key, which is a
 * server-only secret: this decides, in one place a test can reach, when that panel exists
 * at all. Everything else about the comparison lives in `compare-posthog.ts`, which the
 * `npm run compare:posthog` script shares.
 */

/** The one artist whose site runs the mirror. The template's other artists have no PostHog. */
export const CHECK_SLUG = 'skeen'

export type CheckState = 'hidden' | 'ready'

/**
 * `env` is passed in rather than read here so a test can state the case it means. Only the
 * un-prefixed names count: a `NEXT_PUBLIC_` key would be shipped to every fan's browser,
 * and reading one here would quietly reward putting it there.
 */
export function checkState(slug: string, env: Record<string, string | undefined>): CheckState {
  if (slug !== CHECK_SLUG) return 'hidden'
  return env.POSTHOG_PERSONAL_API_KEY && env.POSTHOG_PROJECT_ID ? 'ready' : 'hidden'
}
