'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'
import { SEO_MANUAL_COOLDOWN_S } from '@/lib/seo-tests/store'
import { FOCUS_RING } from '../../../_ui/focus-ring'
import { runSeoTestsAction } from '../test-actions'
import { useNow } from '../test/clock'
import { classifyRunError, secondsLeft, type RunRefusal } from '../test/model'

/**
 * "Test again" on the Overview (r2's Overview 3 has it at the foot, beside "See the tests"). The
 * SAME action and the same states as the Test tab's button (test/test-tab.tsx): running, the
 * one-minute cool-down (the database decides; this only says so early), another run going,
 * a run that failed. Quiet like r2's links: a glyph and a mono word, nothing boxed.
 *
 * The wait shown is never longer than the cool-down itself, so a laptop clock that is wrong
 * can't show "3,660 s" (the UI review, N5).
 */
export function TestAgain({ artistId, can, cooldownEnd, label = 'Test again' }: { artistId: string; can: boolean; cooldownEnd: number | null; label?: string }) {
  const router = useRouter()
  const [running, setRunning] = useState(false)
  const latch = useRef(false)
  const [refusal, setRefusal] = useState<RunRefusal | null>(null)
  const [refusedUntil, setRefusedUntil] = useState<number | null>(null)
  const end = Math.max(cooldownEnd ?? 0, refusedUntil ?? 0) || null
  const peek = useNow(false)
  const now = useNow(running || (end != null && peek != null && peek < end))
  const coolS = now == null ? 0 : Math.min(SEO_MANUAL_COOLDOWN_S, secondsLeft(end, now))
  const disabled = !can || running || coolS > 0 || refusal?.kind === 'busy'

  async function run() {
    // The latch is a ref (AGENTS.md rule 5): two fast clicks both read the pre-render state.
    if (latch.current || disabled) return
    latch.current = true
    setRunning(true)
    setRefusal(null)
    try {
      const res = await runSeoTestsAction(artistId)
      if (res.ok) router.refresh()
      else {
        const why = classifyRunError(res)
        if (why.kind === 'cooldown') setRefusedUntil(Date.now() + why.retryInS * 1000)
        else setRefusal(why)
      }
    } catch {
      setRefusal({ kind: 'failed', error: 'The test couldn’t finish. Try again in a minute.' })
    } finally {
      latch.current = false
      setRunning(false)
    }
  }

  const note = running
    ? 'Testing your site…'
    : refusal?.kind === 'busy'
      ? 'A test is already running.'
      : refusal?.kind === 'failed'
        ? refusal.error
        : coolS > 0
          ? `You can test again in ${coolS} s`
          : null

  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      <button
        type="button"
        onClick={() => void run()}
        disabled={disabled}
        className={cx('inline-flex items-center gap-1.5 rounded font-space text-[12px] text-ink-muted transition-colors hover:text-accent disabled:cursor-default disabled:opacity-50 disabled:hover:text-ink-muted', FOCUS_RING)}
      >
        <Icon name="refresh" size={13} aria-hidden="true" className={running ? 'motion-safe:animate-spin' : undefined} />
        {label}
      </button>
      {note ? (
        <span role="status" className={cx('font-space text-[11px]', refusal?.kind === 'failed' ? 'text-accent-red' : 'text-ink-faint')}>
          {note}
        </span>
      ) : null}
    </span>
  )
}
