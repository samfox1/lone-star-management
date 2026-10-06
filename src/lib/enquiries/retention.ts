/**
 * How long an enquiry is kept, and what the inbox says about it (Sam, 2026-10-05).
 *
 * "If it works correctly, the user will never need to go to the inquiries page, because they
 * receive the emails themselves … nice to have for some days in case that email disconnects …
 * I dont want them to lose important info, but also, I dont want to have to store those files
 * and messages for too long."
 *
 *   status 'sent'   → deleted 30 days after it arrived. The manager has it in their own mail.
 *   anything else   → deleted after 90. Failed, unroutable (nobody set to receive it), still
 *                     queued, or a status added later: the dashboard is the only copy, so it
 *                     gets the longer time. Unknown means the longer time, never the shorter.
 *
 * The attachments go with the enquiry.
 *
 * THE SAME RULE IN SQL: `public.enquiry_delete_at(status, created_at)` in
 * supabase/migrations/20261005120000_enquiry_retention.sql, which the nightly
 * `prune_enquiries()` deletes by. Change one, change both: the two were compared case by case
 * on a local Postgres, and tests/unit/manager-tools/enquiries/enquiry-retention.test.ts pins
 * this half.
 *
 * DAYS ARE 24 HOURS. The SQL adds 720 / 2160 hours, not '30 days', because Postgres adds a
 * day-interval in calendar days of the session's time zone (23 or 25 hours across a clock
 * change). Here it is milliseconds, which never had that problem. Either way the answer is the
 * same in every time zone, so the server-rendered note and the browser's agree.
 *
 * Anchored on `created_at` (when it arrived), for both statuses: it is the one time every row
 * has, and the inbox already shows it.
 */

/** Days an emailed enquiry is kept. */
const KEEP_DAYS_SENT = 30
/** Days every other enquiry is kept. */
const KEEP_DAYS_NOT_SENT = 90

const DAY_MS = 24 * 60 * 60 * 1000

/** When this enquiry becomes due for deletion. Null when `createdAt` is not a date: no
 *  answer beats a wrong one. The nightly job removes it at its first run at or after this. */
export function deleteAt(status: string | null | undefined, createdAt: string): Date | null {
  const created = Date.parse(createdAt)
  if (Number.isNaN(created)) return null
  const days = status === 'sent' ? KEEP_DAYS_SENT : KEEP_DAYS_NOT_SENT
  return new Date(created + days * DAY_MS)
}

/**
 * "deleted in 12 days", "deleted tomorrow", "deleted today".
 *
 * WHOLE DAYS LEFT, ROUNDED DOWN. The job runs nightly, so an enquiry actually goes at the first
 * run after `deleteAt`, never before it: counting down from `deleteAt` can only ever name FEWER
 * days than are really left. That is the safe direction. Rounding up would tell a manager
 * they have a day they do not have, which is how a message they meant to keep gets lost. So a
 * fresh emailed enquiry reads "deleted in 30 days" and, a minute later, "in 29".
 */
export function deletionNote(status: string | null | undefined, createdAt: string, now: number): string | null {
  const goes = deleteAt(status, createdAt)
  if (!goes) return null
  const days = Math.max(0, Math.floor((goes.getTime() - now) / DAY_MS))
  if (days === 0) return 'deleted today'
  if (days === 1) return 'deleted tomorrow'
  return `deleted in ${days} days`
}
