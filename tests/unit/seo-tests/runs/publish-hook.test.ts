/**
 * Every publish that changes a page's words schedules ONE SEO / GEO test run in the background,
 * and ONE sitemap resend to Google; neither can fail or slow the publish.
 *
 * Code:     src/app/artists/[id]/(dashboard)/actions.ts (publishGated's hooks, beside the IndexNow ping)
 * Feature:  Test runs · the run after a publish (which publishes start one)
 * Tier:     STRICT (AGENTS.md "Test depth"): it sits on Publish, the one path whose failure
 *           loses a manager's work.
 * Covers:   • each gated publish that pings IndexNow schedules exactly one run, after it succeeds,
 *             in the name of the manager the password gate checked
 *           • each of those publishes also schedules exactly one sitemap resend, for this artist
 *             (VISIBILITY_RECIPE.md: "The sitemap is resent to Google when content changed")
 *           • Brand (no page words change) schedules none
 *           • a wrong password or a failed publish schedules none
 *           • the scheduler throwing does not fail the publish
 * Not here: what the scheduled run then does (runs/after-publish.test.ts); what the resend does
 *           (tests/unit/search-engines/resubmit.test.ts); the publish itself (tests/unit/publish/).
 * Fixtures: the two schedulers are mocks (the real ones are tested in their own files); the
 *           password check, the publish actions and the PostgREST fake (which can refuse the
 *           revision insert) come from tests/helpers/publish-world.ts; next/cache and
 *           next/server are mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { A, WRONG_PASSWORD, gate, publishCases, setWorld, world } from '@tests/helpers/publish-world'

const h = vi.hoisted(() => ({ schedule: vi.fn(), resubmit: vi.fn() }))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), unstable_cache: (fn: unknown) => fn }))
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: vi.fn() }))
vi.mock('@supabase/supabase-js', async (orig) => (await import('@tests/helpers/publish-world')).passwordMock(orig))
vi.mock('@/lib/supabase/server', async () => (await import('@tests/helpers/publish-world')).serverMock)
vi.mock('@/lib/seo-tests/after-publish', () => ({ scheduleSeoTestRun: h.schedule }))
vi.mock('@/lib/search-engines/resubmit', () => ({ scheduleSitemapResubmit: h.resubmit }))

beforeEach(() => {
  setWorld(world())
  h.schedule.mockReset()
  h.resubmit.mockReset()
  gate.error = null
})

describe('the SEO / GEO run after a publish', () => {
  // Each publish path: exactly one run, for this artist, in the checked manager's name (the per-person limits count it).
  it.each(publishCases((e) => e.pings))('CRITICAL: $name schedules exactly one run, for this artist, after it succeeds', async ({ run }) => {
    const actions = await import('@/app/artists/[id]/(dashboard)/actions')
    expect(await run(actions)).toEqual({ ok: true })
    expect(h.schedule).toHaveBeenCalledTimes(1)
    expect(h.schedule.mock.calls[0][1]).toBe(A)
    // The manager the password gate verified: the run's claim is made in their name (the
    // database's per-person limits count it), by the service role.
    expect(h.schedule.mock.calls[0][2]).toBe('u1')
    // And one sitemap resend to Google for this artist (it decides for itself whether the site
    // is registered).
    expect(h.resubmit).toHaveBeenCalledTimes(1)
    expect(h.resubmit.mock.calls[0][0]).toBe(A)
  })

  // Brand: colours, fonts and logos change no page's words, so there is nothing new to test.
  it("Brand's publish schedules none: colours, fonts and logos change no page's words", async () => {
    const { publishBrandWithPasswordAction } = await import('@/app/artists/[id]/(dashboard)/actions')
    expect(await publishBrandWithPasswordAction(A, 'pw')).toEqual({ ok: true })
    expect(h.schedule).not.toHaveBeenCalled()
    expect(h.resubmit).not.toHaveBeenCalled()
  })

  // Nothing went live: a wrong password or a failed publish starts no run.
  it('CRITICAL: a wrong password or a FAILED publish schedules none: nothing new is live to test', async () => {
    const { publishAction } = await import('@/app/artists/[id]/(dashboard)/actions')
    gate.error = WRONG_PASSWORD
    await publishAction(A, 'nope')
    gate.error = null
    setWorld(world({ insertError: true }))
    expect(await publishAction(A, 'pw')).toEqual({ ok: false, error: 'insert refused' })
    expect(h.schedule).not.toHaveBeenCalled()
    expect(h.resubmit).not.toHaveBeenCalled()
  })

  // The publish is already live: a scheduler crash must not turn it into a reported failure.
  it('CRITICAL: the scheduler throwing does not fail the publish', async () => {
    h.schedule.mockImplementation(() => {
      throw new Error('scheduler exploded')
    })
    const { publishAction } = await import('@/app/artists/[id]/(dashboard)/actions')
    expect(await publishAction(A, 'pw')).toEqual({ ok: true })
  })
})
