'use client'

import { useEffect, useRef, useState } from 'react'
import { cx } from '@/lib/cx'
import { useConfirm } from '../../confirm-dialog'
import { PublishPasswordDialog } from '../../publish-bar'
import { liftToasts, toast } from '../../toast'

export type PublishRiserProps = {
  /** A REAL change is waiting (brand-scoped). Opening a modal, focusing a field or picking
   *  the same value is not one, and must not set this. */
  dirty: boolean
  /** WHAT changed: "Primary logo changed", "2 changes". The bar adds " · not on the site
   *  yet" itself (NOT_LIVE), so no caller can forget it or say it twice. */
  message: string
  /** Password-gated, exactly as PublishBar's: the same dialog hands the password here. */
  onPublish: (password: string) => Promise<{ ok: boolean; error?: string }>
  /** Throws away every unpublished change. Revert is not rendered without it. */
  onRevert?: () => Promise<{ error?: string } | void> | { error?: string } | void
  /** Plural noun for the password dialog's copy. */
  noun?: string
}

/**
 * THE ONE PUBLISH BAR on the Brand page (Sam, 2026-09-23, BRAND_PAGE_PLAN.md): bottom of
 * the screen, bigger than PublishBar's floating button — taller, a 15px message, 14px
 * buttons — with a red dot, "<what changed> · not on the site yet", Revert and Publish.
 *
 * HIDDEN UNTIL A REAL CHANGE, and hidden means GONE: translated below the viewport, and
 * `aria-hidden` + `inert` so its buttons are not Tab stops and cannot be clicked. A bar
 * that were only transparent would still sit over the page's last row catching clicks.
 * It stays MOUNTED while hidden so it can slide up when `dirty` arrives; the slide is
 * `motion-safe`, so prefers-reduced-motion gets it without the movement.
 *
 * Publish opens publish-bar.tsx's PublishPasswordDialog — the same dialog, latch and
 * mid-publish lock every content page uses, not a copy of them.
 *
 * WHILE UP IT LIFTS THE TOASTS by its own height (`liftToasts`): the stack sits
 * bottom-right, on top of Revert and Publish, and a toast raised mid-edit covered them
 * (visual check, 2026-09-23). Measured, not a constant, so the safe-area padding counts.
 * The same measurement sizes an in-flow SPACER, so the page gains the room the fixed bar
 * takes (review 2, 2026-09-24: the layout's `pb-28` alone left the bottom colour row's
 * panel, hex box and all, under the bar). Down, the spacer is 0.
 *
 * The password prompt belongs to the change it would publish: when `dirty` goes (published
 * or reverted from another tab), the prompt closes AND is dropped, typed password with it.
 * Only hiding it (`open && dirty`) brought it back by itself on the next change, filled
 * in — one Enter from publishing (review 2, 2026-09-24).
 *
 * The message WRAPS rather than truncates: on a phone the ellipsis ate "· not on the site
 * yet", the one part every message shares (review 2, 2026-09-24).
 */
/** The spec's tail on every message (BRAND_PAGE_PLAN.md: "<what changed> · not on the site yet"). */
const NOT_LIVE = ' · not on the site yet'

export function PublishRiser({ dirty, message, onPublish, onRevert, noun = 'brand' }: PublishRiserProps) {
  const [open, setOpen] = useState(false)
  // `dirty` going false closes the prompt (state adjusted while rendering, React's pattern
  // for "reset when a prop changes"); the dialog is also unmounted then, which drops its
  // password.
  const [wasDirty, setWasDirty] = useState(dirty)
  if (wasDirty !== dirty) {
    setWasDirty(dirty)
    if (!dirty) setOpen(false)
  }
  const [reverting, setReverting] = useState(false)
  // The re-entry latch is a ref (AGENTS.md rule 5): `reverting` is state and lags a click.
  const revertingRef = useRef(false)
  const { ask, dialog } = useConfirm()
  const barRef = useRef<HTMLDivElement>(null)
  /** The in-flow room the fixed bar takes while up. Sized from the DOM, not state: the
   *  measurement lands straight on it, with no extra render. */
  const spacerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = barRef.current
    if (!dirty || !el) return
    const room = (px: number) => {
      if (spacerRef.current) spacerRef.current.style.height = `${px}px`
    }
    const measure = () => {
      liftToasts(el.offsetHeight)
      room(el.offsetHeight)
    }
    measure()
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    ro?.observe(el)
    return () => {
      ro?.disconnect()
      liftToasts(0)
      room(0)
    }
  }, [dirty])

  async function revert() {
    if (!onRevert || revertingRef.current) return
    revertingRef.current = true
    try {
      if (!(await ask("Revert every brand change that isn't on the site yet? This can't be undone.", { action: 'Revert', tone: 'danger' }))) return
      setReverting(true)
      const res = await onRevert()
      if (res && 'error' in res && res.error) toast(res.error, 'error')
    } catch {
      toast("Couldn't revert those changes.", 'error')
    } finally {
      revertingRef.current = false
      setReverting(false)
    }
  }

  return (
    <>
      <div ref={spacerRef} data-publish-riser-spacer="" aria-hidden="true" style={{ height: 0 }} />
      <div
        ref={barRef}
        data-publish-riser=""
        aria-hidden={dirty ? undefined : true}
        inert={!dirty}
        className={cx(
          'fixed inset-x-0 bottom-0 z-40 flex items-center justify-between gap-4 border-t border-hairline bg-paper px-4 pt-[18px] pb-[calc(18px+env(safe-area-inset-bottom,0px))] sm:px-8',
          'motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-out',
          // The shadow only while up: it reaches 32px ABOVE the bar, so a hidden bar parked
          // just below the viewport would still grey its bottom edge (2026-09-23 screenshot).
          dirty ? 'translate-y-0 shadow-[0_-8px_24px_rgba(0,0,0,0.05)]' : 'translate-y-[110%]',
        )}
      >
        <p className="flex min-w-0 items-start">
          {/* mt-[6px]: centred on the first line (15px × leading-snug) however many it wraps to. */}
          <span aria-hidden="true" className="mr-2.5 mt-[6px] h-[9px] w-[9px] flex-none rounded-full bg-accent-red" />
          <span className="min-w-0 text-[15px] leading-snug text-ink [overflow-wrap:anywhere]">{message ? `${message}${NOT_LIVE}` : ''}</span>
        </p>
        <div className="flex flex-none items-center gap-2">
          {onRevert ? (
            <button
              type="button"
              onClick={() => void revert()}
              disabled={reverting}
              className="rounded-[10px] px-[18px] py-2.5 text-[14px] font-medium text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink disabled:opacity-50"
            >
              {reverting ? 'Reverting…' : 'Revert'}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-[10px] border border-ink bg-ink px-[22px] py-2.5 text-[14px] font-medium text-paper transition-opacity hover:opacity-85"
          >
            Publish
          </button>
        </div>
      </div>
      {dirty ? <PublishPasswordDialog open={open} onClose={() => setOpen(false)} onPublish={onPublish} noun={noun} /> : null}
      {dialog}
    </>
  )
}
