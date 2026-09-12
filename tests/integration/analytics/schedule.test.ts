// The nightly analytics maintenance is scheduled, active, and runs as a role that can see
// the rows it aggregates. Step 4 of ANALYTICS_PAGE_PLAN.md.
/**
 * A schedule is the one piece of this system with no caller to break: nothing in the app
 * imports it, so if the extension is dropped, a job is unscheduled, or the runner loses
 * BYPASSRLS, every test still passes and the tallies quietly stop being written. These
 * assertions are the only thing standing between that and a month of zeroed cards.
 *
 * BYPASSRLS is the assumption worth naming. Both `roll_up_pending` and `prune_analytics`
 * are `security invoker`, so they aggregate what their caller can SEE. `analytics_events`
 * is owner-read only, so a runner without BYPASSRLS reads nothing and the roll-up writes
 * EMPTY tallies over correct ones — a silent data loss, not an error.
 *
 * Read through `analytics_schedule()` because the `cron` schema is not exposed to PostgREST.
 */
import { describe, expect, it } from 'vitest'
import { SEED, anonClient, serviceClient, signInAs } from '@tests/helpers/supabase'
import { expectExecuteDenied } from '@tests/helpers/rls'

const svc = serviceClient()

type Job = {
  jobname: string
  schedule: string
  command: string
  active: boolean
  runs_as: string
  bypasses_rls: boolean
  last_run: string | null
  last_status: string | null
  last_message: string | null
}

/** What must be scheduled, and what each job must run. Hand-listed on purpose: this is the
 *  change detector — editing a schedule should mean editing this line, consciously. */
const EXPECTED = [
  { jobname: 'analytics-roll-up', schedule: '10 3 * * *', command: 'select public.roll_up_pending()' },
  { jobname: 'analytics-prune', schedule: '40 3 * * *', command: 'select public.prune_analytics()' },
] as const

const jobs = async (): Promise<Job[]> => {
  const { data, error } = await svc.rpc('analytics_schedule')
  expect(error).toBeNull()
  return (data ?? []) as Job[]
}
const minuteOf = (cron: string) => Number(cron.split(' ')[0])

describe('the nightly analytics schedule', () => {
  it('CRITICAL: both jobs exist, are active, and run exactly the maintenance functions', async () => {
    const found = await jobs()
    expect(found.map((j) => j.jobname).sort()).toEqual(EXPECTED.map((e) => e.jobname).sort())
    for (const want of EXPECTED) {
      const job = found.find((j) => j.jobname === want.jobname)!
      expect(job.schedule, want.jobname).toBe(want.schedule)
      expect(job.command.trim(), want.jobname).toBe(want.command)
      expect(job.active, `${want.jobname} is scheduled but switched off`).toBe(true)
    }
  })

  it('CRITICAL: the runner bypasses RLS — without it the roll-up would write empty tallies over good ones', async () => {
    for (const job of await jobs()) {
      expect(job.bypasses_rls, `${job.jobname} runs as ${job.runs_as}, which cannot see analytics_events`).toBe(true)
    }
  })

  it('prune runs strictly after the roll-up, so it never races its own input', async () => {
    const found = await jobs()
    const rollUp = found.find((j) => j.jobname === 'analytics-roll-up')!
    const prune = found.find((j) => j.jobname === 'analytics-prune')!
    // Same hour, prune later in it. Prune only removes raw rows for days already in the
    // ledger, so a roll-up still in flight would be reading input that is being deleted.
    expect(rollUp.schedule.split(' ').slice(1)).toEqual(prune.schedule.split(' ').slice(1))
    expect(minuteOf(prune.schedule)).toBeGreaterThan(minuteOf(rollUp.schedule))
  })

  it('the last run, if there has been one, did not fail', async () => {
    for (const job of await jobs()) {
      if (job.last_run === null) continue // freshly scheduled; nothing has fired yet
      expect(job.last_status, `${job.jobname} last run: ${job.last_message}`).toBe('succeeded')
    }
  })

  it('the readout is service-only: anon and a signed-in manager are refused', async () => {
    expectExecuteDenied((await anonClient().rpc('analytics_schedule')).error, 'analytics_schedule')
    const asA = await signInAs(SEED.managerA)
    expectExecuteDenied((await asA.rpc('analytics_schedule')).error, 'analytics_schedule')
  })
})
