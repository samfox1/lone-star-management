'use client'

import { useEffect, useRef, useSyncExternalStore, type CSSProperties } from 'react'
import { Icon } from '@/components/ui/icons'
import { cx } from '@/lib/cx'

/**
 * THE AI TEST'S DRAWINGS (Sam, 2026-09-29, prototypes/seo_variants_20260929_r10.html):
 *
 *   StartArt    before the first test: a small web page with ONE magnifying glass wandering
 *               over it. Under the glass the page is bigger and readable (two layers: the plain
 *               drawing, and a scaled copy clipped to a circle where the glass is).
 *   PageScan    while a test runs: the same page, a blue beam sweeping up and down it, each
 *               part lighting up with its name as the beam crosses.
 *   VisitingAs  beside it: who we visit as, dots on a thin line, a blue glow running from one
 *               to the next and back to the top after the last.
 *
 * ALL DECORATION. None of it follows the real run: nothing here ever says a part or a visitor
 * is done (no ticks), and each drawing is `aria-hidden`; the tab says "testing" in words for a
 * screen reader. The motion is driven straight on the DOM (requestAnimationFrame, the Web
 * Animations API, data attributes), never through React state, so a frame never re-renders the
 * tab. Every loop, interval and animation stops when its drawing unmounts. With
 * prefers-reduced-motion nothing moves: the glass sits still over the title, there is no beam
 * and no glow.
 */

const REDUCE = '(prefers-reduced-motion: reduce)'

function motionQuery(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(REDUCE) : null
}

function onMotionChange(cb: () => void) {
  const mq = motionQuery()
  mq?.addEventListener?.('change', cb)
  return () => mq?.removeEventListener?.('change', cb)
}

/** prefers-reduced-motion, live. False on the server (the drawings start still anyway). */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(onMotionChange, () => !!motionQuery()?.matches, () => false)
}

const canAnimateFrames = () => typeof requestAnimationFrame === 'function' && typeof cancelAnimationFrame === 'function'

/* ── the page drawing ────────────────────────────────────────────────────────────────── */

const DOT = 'h-1.5 w-1.5 rounded-full bg-hairline'

/** The browser bar: three dots and the site's address. */
function Bar({ host, readable }: { host: string; readable?: boolean }) {
  return (
    <div className="flex h-7 items-center gap-[5px] border-b border-hairline px-2.5">
      <i className={DOT} />
      <i className={DOT} />
      <i className={DOT} />
      <span className={cx('ml-2 truncate font-space text-[10px]', readable ? 'text-ink' : 'text-ink-faint')}>{host}</span>
    </div>
  )
}

/** The start drawing's page. `readable`: the copy under the glass, where the words show. */
function StartPage({ host, name, readable = false }: { host: string; name: string; readable?: boolean }) {
  // Neutral words only: the artist's name and address are real, nothing else claims a fact.
  // Long enough to fill each line, so the glass finds words wherever it wanders.
  const lines = [`Welcome to ${name}’s official site: new music, shows, photos and news.`, 'Listen on your favourite apps, find where to catch the next show,', 'and follow along for everything new.']
  const words = readable ? 'text-ink-muted' : 'text-transparent'
  return (
    <>
      <Bar host={host} readable={readable} />
      <div className="flex flex-col gap-3.5 px-3.5 pb-[18px] pt-4">
        <div
          className={cx(
            'flex h-3.5 w-[58%] items-center overflow-hidden whitespace-nowrap rounded-[5px] pl-1 text-[10px] font-semibold leading-[14px]',
            readable ? 'bg-transparent text-ink' : 'bg-hairline text-transparent',
          )}
        >
          {`${name} · Official site`}
        </div>
        <div className={cx('flex h-[70px] items-center justify-center rounded-[5px]', readable ? 'bg-hairline' : 'bg-hairline-soft')}>
          <Icon name="photo" size={22} className={readable ? 'text-ink-muted' : 'text-transparent'} />
        </div>
        <div className="flex flex-col gap-[7px] py-0.5">
          {lines.map((l, i) => (
            <span
              key={l}
              className={cx(
                'block h-[7px] overflow-hidden whitespace-nowrap rounded text-[6px] leading-[7px]',
                readable ? 'bg-transparent' : 'bg-hairline-soft',
                words,
                i === 1 && 'w-[92%]',
                i === 2 && 'w-[70%]',
              )}
            >
              {l}
            </span>
          ))}
        </div>
        <div className={cx('h-[30px] overflow-hidden whitespace-nowrap rounded-[5px] border border-dashed pl-[5px] font-space text-[6px] leading-[28px]', readable ? 'border-ink-faint' : 'border-hairline', words)}>
          {`{ "name": "${name}", "url": "https://${host}", "sameAs": [ … ] }`}
        </div>
      </div>
    </>
  )
}

/** Where the glass rests when nothing moves: over the artist's name. */
const REST = { x: 36, y: 51 }

export function StartArt({ host, name }: { host: string; name: string }) {
  const pageRef = useRef<HTMLDivElement>(null)
  const zoomRef = useRef<HTMLDivElement>(null)
  const lensRef = useRef<HTMLDivElement>(null)
  const calm = useReducedMotion()

  useEffect(() => {
    const page = pageRef.current
    const zoom = zoomRef.current
    const lens = lensRef.current
    if (!page || !zoom || !lens) return
    const place = (x: number, y: number) => {
      lens.style.transform = `translate(${x}px, ${y}px)`
      zoom.style.setProperty('--x', `${x}px`)
      zoom.style.setProperty('--y', `${y}px`)
    }
    if (calm || !canAnimateFrames()) {
      place(REST.x, REST.y)
      return
    }
    // A slow loop over the whole page: two sine waves at different speeds, so the path never
    // quite repeats and the glass passes over every part (the mock's runLens).
    let raf = 0
    let t0 = 0
    const frame = (ts: number) => {
      if (!t0) t0 = ts
      const t = ts - t0
      const w = page.offsetWidth
      const h = page.offsetHeight
      place(w / 2 + (w / 2 - 46) * Math.sin(t / 1900 - 1.2), 28 + (h - 28) / 2 + ((h - 28) / 2 - 26) * Math.sin(t / 1300 - 0.9))
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [calm])

  const at = { '--x': `${REST.x}px`, '--y': `${REST.y}px` } as CSSProperties
  return (
    <div aria-hidden="true" className="relative mx-auto mb-[26px] w-[300px]">
      <div ref={pageRef} className="relative w-[300px] overflow-hidden rounded-xl border border-hairline bg-paper text-left">
        <StartPage host={host} name={name} />
        {/* The magnified copy: clipped to the glass, scaled around the glass's centre. */}
        <div ref={zoomRef} className="pointer-events-none absolute inset-0" style={{ ...at, clipPath: 'circle(26px at var(--x, 50%) var(--y, 50%))' }}>
          <div className="absolute inset-0 bg-paper" style={{ transformOrigin: 'var(--x, 50%) var(--y, 50%)', transform: 'scale(1.9)' }}>
            <StartPage host={host} name={name} readable />
          </div>
        </div>
      </div>
      <div
        ref={lensRef}
        style={{ transform: `translate(${REST.x}px, ${REST.y}px)` }}
        className={cx(
          'pointer-events-none absolute left-0 top-0 -ml-[29px] -mt-[29px] h-[58px] w-[58px] rounded-full border-[2.5px] border-ink will-change-transform',
          'shadow-[0_10px_24px_rgba(0,0,0,0.12),inset_0_0_0_2px_rgba(255,255,255,0.7)]',
          // the glint on the glass
          "before:absolute before:left-[9px] before:top-2 before:h-[7px] before:w-3.5 before:-rotate-30 before:rounded-[50%] before:border-t-2 before:border-white/85 before:content-['']",
          // the handle
          "after:absolute after:left-[calc(50%+17px)] after:top-[calc(50%+17px)] after:h-6 after:w-1 after:origin-top after:-translate-x-1/2 after:-rotate-45 after:rounded-[3px] after:bg-ink after:content-['']",
        )}
      />
    </div>
  )
}

/* ── while a test runs ───────────────────────────────────────────────────────────────── */

/** A part of the page: lit (`data-hit`) while the beam crosses it, with its name on a tag. It
 *  lights fast and fades slowly. */
const PART = 'group relative rounded-[5px] transition-[background-color,box-shadow,border-color] duration-500 data-hit:bg-accent-soft data-hit:duration-100'
/** A blue outline while lit (the dashed fact card turns its own border blue instead). */
const RING = 'data-hit:shadow-[0_0_0_1px_var(--color-accent)]'

function Tag({ children }: { children: string }) {
  return (
    <span className="absolute -top-2 right-1.5 translate-y-0.5 whitespace-nowrap rounded-[5px] bg-accent px-1.5 py-0.5 font-space text-[9.5px] leading-[1.3] tracking-[0.02em] text-white opacity-0 transition-[opacity,translate] duration-700 group-data-hit:translate-y-0 group-data-hit:opacity-100 group-data-hit:duration-100">
      {children}
    </span>
  )
}

const LINE = 'block h-[7px] rounded bg-hairline-soft transition-colors duration-500 group-data-hit:bg-accent-soft group-data-hit:duration-100'

export function PageScan({ host }: { host: string }) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const beamRef = useRef<HTMLDivElement>(null)
  const calm = useReducedMotion()

  useEffect(() => {
    const body = bodyRef.current
    const beam = beamRef.current
    if (!body || !beam || calm || !canAnimateFrames()) return
    const parts = Array.from(body.querySelectorAll<HTMLElement>('[data-scan-part]'))
    // Down and back up in 2.6 s each way, eased at both ends (the mock's runBeam).
    const P = 2600
    let raf = 0
    let t0 = 0
    const frame = (ts: number) => {
      if (!t0) t0 = ts
      const p = ((ts - t0) % (P * 2)) / P
      const x = p < 1 ? p : 2 - p
      const e = x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2
      const y = body.offsetTop + 6 + e * (body.offsetHeight - 12)
      beam.style.transform = `translateY(${y}px)`
      for (const part of parts) part.toggleAttribute('data-hit', y >= part.offsetTop - 3 && y <= part.offsetTop + part.offsetHeight + 3)
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      for (const part of parts) part.removeAttribute('data-hit')
    }
  }, [calm])

  return (
    <div aria-hidden="true" className="relative w-[280px] overflow-hidden rounded-xl border border-hairline bg-paper">
      <Bar host={host} />
      <div ref={bodyRef} className="flex flex-col gap-3.5 px-3.5 pb-[18px] pt-4">
        <div data-scan-part="" className={cx(PART, RING, 'h-3.5 w-[58%] bg-hairline')}>
          <Tag>Page title</Tag>
        </div>
        <div data-scan-part="" className={cx(PART, RING, 'h-[88px] bg-hairline-soft')}>
          <Tag>Photo descriptions</Tag>
        </div>
        <div data-scan-part="" className={cx(PART, RING, 'flex flex-col gap-[7px] py-0.5')}>
          <span className={LINE} />
          <span className={cx(LINE, 'w-[92%]')} />
          <span className={cx(LINE, 'w-[70%]')} />
          <Tag>Bio</Tag>
        </div>
        <div data-scan-part="" className={cx(PART, 'h-[30px] border border-dashed border-hairline data-hit:border-accent')}>
          <Tag>Fact card</Tag>
        </div>
      </div>
      {calm ? null : (
        <div ref={beamRef} className="absolute inset-x-0 top-0 h-0.5 bg-accent shadow-[0_0_16px_3px_color-mix(in_srgb,var(--color-accent)_40%,transparent)] will-change-transform" />
      )}
    </div>
  )
}

/** Who a run visits as, in the order the tests read them (bots.ts, then MusicBrainz). */
export const VISITORS = ['Google', 'Bing', 'ChatGPT', 'Claude', 'Perplexity', 'Apple', 'MusicBrainz'] as const

/** How long each visitor stays lit before the glow moves on. */
const STEP_MS = 1400

export function VisitingAs() {
  const wrapRef = useRef<HTMLDivElement>(null)
  const glowRef = useRef<HTMLSpanElement>(null)
  const calm = useReducedMotion()

  useEffect(() => {
    const wrap = wrapRef.current
    const glow = glowRef.current
    if (!wrap) return
    const items = Array.from(wrap.querySelectorAll<HTMLElement>('[data-visitor]'))
    if (!items.length) return
    const mid = (li: HTMLElement) => li.offsetTop + li.offsetHeight / 2
    let alive = true
    let move: Animation | null = null
    const light = (k: number) => {
      items.forEach((li, j) => li.toggleAttribute('data-on', j === k))
      if (calm) return
      // A small ripple as the dot lights.
      items[k].querySelector<HTMLElement>('[data-ripple]')?.animate?.(
        [
          { transform: 'scale(1)', opacity: 0.8 },
          { transform: 'scale(3.2)', opacity: 0 },
        ],
        { duration: 750, easing: 'ease-out' },
      )
    }
    if (glow) glow.style.transform = `translateY(${mid(items[0])}px)`
    light(0)
    let i = 0
    const step = () => {
      const from = i
      const to = (i + 1) % items.length
      i = to
      items[from].removeAttribute('data-on')
      if (calm || !glow || typeof glow.animate !== 'function') {
        light(to)
        return
      }
      // The glow leaves the lit dot, runs down the line (or back up to the top after the
      // last), and lights the next one when it gets there.
      const up = to < from
      glow.toggleAttribute('data-up', up)
      glow.setAttribute('data-moving', '')
      const a = glow.animate([{ transform: `translateY(${mid(items[from])}px)` }, { transform: `translateY(${mid(items[to])}px)` }], {
        duration: up ? 900 : 560,
        easing: 'cubic-bezier(.6,0,.25,1)',
        fill: 'forwards',
      })
      move = a
      a.onfinish = () => {
        if (!alive) return
        glow.style.transform = `translateY(${mid(items[to])}px)`
        a.cancel()
        glow.removeAttribute('data-moving')
        light(to)
      }
    }
    const timer = setInterval(step, STEP_MS)
    return () => {
      alive = false
      clearInterval(timer)
      move?.cancel()
      glow?.removeAttribute('data-moving')
      for (const li of items) li.removeAttribute('data-on')
    }
  }, [calm])

  return (
    <div aria-hidden="true" className="text-left">
      <div className="mb-2 font-space text-[10px] uppercase tracking-[0.12em] text-ink-faint">Visiting as</div>
      <div ref={wrapRef} className="relative before:absolute before:bottom-[18px] before:left-1 before:top-[18px] before:w-px before:bg-ink-faint/45 before:content-['']">
        <ul>
          {VISITORS.map((v) => (
            <li key={v} data-visitor="" className="group flex h-9 items-center gap-3.5 text-[15px] text-ink-faint transition-colors duration-[350ms] data-on:text-ink">
              <i className="relative z-[2] box-border h-[9px] w-[9px] flex-none rounded-full border-[1.5px] border-ink-faint/70 bg-paper transition-[background-color,border-color,box-shadow] duration-[350ms] group-data-on:border-accent group-data-on:bg-accent group-data-on:shadow-[0_0_0_4px_var(--color-accent-soft)]">
                <span data-ripple="" className="absolute -inset-[1.5px] rounded-full border-[1.5px] border-accent opacity-0" />
              </i>
              {v}
            </li>
          ))}
        </ul>
        {calm ? null : (
          <span
            ref={glowRef}
            className={cx(
              'pointer-events-none absolute left-[4.5px] top-0 z-[1] h-0 w-0',
              // the tail, behind the bead (above it when running back up)
              "before:absolute before:-left-px before:bottom-0 before:h-[34px] before:w-0.5 before:rounded-[2px] before:bg-linear-to-b before:from-transparent before:to-accent before:opacity-0 before:transition-opacity before:duration-250 before:content-['']",
              'data-up:before:bottom-auto data-up:before:top-0 data-up:before:bg-linear-to-t',
              // the bead
              "after:absolute after:-left-[3.5px] after:-top-[3.5px] after:h-[7px] after:w-[7px] after:rounded-full after:bg-accent after:opacity-0 after:shadow-[0_0_12px_3px_color-mix(in_srgb,var(--color-accent)_55%,transparent)] after:transition-opacity after:duration-250 after:content-['']",
              'data-moving:before:opacity-100 data-moving:before:duration-75 data-moving:after:opacity-100 data-moving:after:duration-75',
            )}
          />
        )}
      </div>
    </div>
  )
}
