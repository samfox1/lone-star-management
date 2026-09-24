'use client'

import { useEffect, useLayoutEffect, useRef, useState, type MouseEventHandler, type Ref } from 'react'
import { createPortal } from 'react-dom'
import { Icon, type IconName } from '@/components/ui/icons'
import { cx } from '@/lib/cx'
import { placeLabel, type LabelAlign } from './label-placement'

/**
 * ICONS, NOT WORDS (Sam, 2026-09-23, BRAND_PAGE_PLAN.md). Every Brand row action is a
 * glyph with a small dark label that appears on hover or keyboard focus: "Edit",
 * "Preview", "Upload new", "Remove", "Add logo", "Change font", "Remove background".
 *
 * The label is the button's accessible name too (`aria-label`), and the visible chip is
 * `aria-hidden`, so a screen reader hears it once. `labelSide` and `labelAlign` are
 * PREFERENCES (see HoverLabel): the chip flips and shifts to stay on screen and inside the
 * box it sits in.
 *
 * A client module (HoverLabel watches its control), but RowIcon's props are plain, so a
 * server component can still render the `href` form (the brand-kit download).
 */
export type RowIconVariant =
  /** A row action: 40% until its LedgerRow is hovered (or it is focused). */
  | 'faint'
  /** The empty state's one action (+): full ink, and a blue focus ring, because focus
   *  lands here after the note (Enter) and the manager must see where it went. */
  | 'primary'
  /** A bordered square — modal actions, the add form's ✓ and ×, the kit download. */
  | 'boxed'

export type RowIconProps = {
  icon: IconName
  /** Accessible name AND the hover label, e.g. "Change font". */
  label: string
  variant?: RowIconVariant
  /** Where the hover label opens. `top` for controls at the bottom of a modal. */
  labelSide?: 'bottom' | 'top'
  /** How the hover label lines up with the control. `end` for a control at a right edge. */
  labelAlign?: HoverLabelAlign
  /** `boxed` only: 44px (modal actions) or 36px (add form, kit). */
  size?: 'md' | 'sm'
  /** Hover colour: `accent` for ✓ and every +, `danger` for × and trash. A `plus` icon is
   *  `accent` unless told otherwise (Sam, 2026-09-23: every + turns blue, as the trash
   *  turns red). */
  tone?: 'default' | 'accent' | 'danger'
  /** A real link instead of a button (the brand-kit download). */
  href?: string
  onClick?: MouseEventHandler<HTMLButtonElement>
  disabled?: boolean
  /** The button, so a NoteField's Enter can move focus here. */
  ref?: Ref<HTMLButtonElement>
  className?: string
}

const TONE: Record<NonNullable<RowIconProps['tone']>, string> = {
  default: 'hover:text-ink',
  // Keyboard focus too: the + is where focus lands after a note's Enter.
  accent: 'hover:text-accent focus-visible:text-accent',
  danger: 'hover:text-accent-red',
}

const VARIANT: Record<RowIconVariant, string> = {
  // The row is `group/ledger` (ledger.tsx). Its own hover and keyboard focus light it too,
  // so it is never a control that only a mouse over the row can find.
  faint: 'rounded-lg p-1.5 text-ink-muted opacity-40 hover:bg-surface-hover hover:opacity-100 focus-visible:opacity-100 group-hover/ledger:opacity-100',
  primary: 'rounded-lg p-1.5 text-ink hover:bg-surface-hover',
  boxed: 'rounded-xl border border-hairline text-ink-muted hover:bg-surface-hover',
}

const BOX: Record<NonNullable<RowIconProps['size']>, { cls: string; glyph: number }> = {
  md: { cls: 'h-11 w-11', glyph: 22 },
  sm: { cls: 'h-9 w-9 rounded-[9px]', glyph: 18 },
}

/** How a hover label lines up with its control: centred on it, or flush with its left
 *  (`start`) or right (`end`) edge so the chip opens inward from an edge. */
export type HoverLabelAlign = LabelAlign

/** The chip: ink, paper text, 12px, 6×9 padding, 7px radius — the prototype's. */
const CHIP =
  'pointer-events-none fixed left-0 top-0 z-[100] whitespace-nowrap rounded-[7px] bg-ink px-[9px] py-1.5 font-ui text-[12px] font-medium leading-none text-paper ' +
  'motion-safe:transition-[opacity,translate] motion-safe:duration-150 motion-safe:starting:opacity-0 ' +
  'motion-safe:starting:data-[placed=top]:translate-y-1 motion-safe:starting:data-[placed=bottom]:-translate-y-1'

/** The nearest ancestor that clips or scrolls its content (a modal's scrolling middle, the
 *  card's overflow-hidden) — the box a chip must stay inside to be read. */
function clippingAncestor(el: Element): Element | null {
  for (let n = el.parentElement; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
    const cs = getComputedStyle(n)
    if ([cs.overflowX, cs.overflowY, cs.overflow].some((v) => v && v !== 'visible')) return n
  }
  return null
}

function focusVisible(el: Element) {
  try {
    return el.matches(':focus-visible')
  } catch {
    return true
  }
}

/**
 * THE HOVER LABEL, for every Brand control (RowIcon, the board's background circles, the
 * playground's dots). One definition, so every label on the page is the same chip.
 *
 * PORTALED AND FIXED (Sam, 2026-09-23: the icon editor's "Upload new" was cut off by the
 * modal body's top edge). A chip inside its control was clipped by any scrolling or
 * overflow-hidden ancestor. It now renders in document.body at `position: fixed`, placed by
 * `placeLabel` (label-placement.ts) from the control's rect, the viewport and the nearest
 * clipping ancestor's rect: the preferred side and alignment when they fit, else flipped and
 * shifted to stay inside both. It is re-placed every frame while shown (scroll, resize, a
 * sliding bar, a control that moves), and on any scroll or resize at once.
 *
 * ABSENT UNLESS SHOWN. Not rendered at all until its control is hovered by a mouse (never a
 * touch) or keyboard-focused, so a hidden chip cannot widen the page (visual check,
 * 2026-09-23: a transparent chip gave the page a horizontal scrollbar).
 *
 * The control keeps only a MARKER: a zero-size, empty span carrying `data-side` and
 * `data-align` (the preferences). Hiding that marker (`display: none`) keeps the chip away —
 * the fonts menu (`[&>[data-side]]:hidden`) and the colour picker
 * (`[&>button>[data-side]]:hidden`) do that while they are open. A disabled control shows no
 * chip either. Its control must be `relative` (every caller is), so the marker sits inside it.
 */
export function HoverLabel({ label, side = 'bottom', align = 'center' }: { label: string; side?: 'bottom' | 'top'; align?: HoverLabelAlign }) {
  const markerRef = useRef<HTMLSpanElement>(null)
  const chipRef = useRef<HTMLSpanElement>(null)
  const [active, setActive] = useState(false)

  // Watch the control: a mouse over it, or keyboard focus on it.
  useEffect(() => {
    const anchor = markerRef.current?.parentElement
    if (!anchor) return
    let hovered = false
    let focused = false
    const sync = () => setActive(hovered || focused)
    // A disabled control says nothing: there is nothing it would do.
    const enter = (e: PointerEvent) => {
      if (e.pointerType === 'touch' || anchor.matches(':disabled')) return
      hovered = true
      sync()
    }
    const leave = () => {
      hovered = false
      sync()
    }
    const focus = () => {
      focused = focusVisible(anchor) && !anchor.matches(':disabled')
      sync()
    }
    const blur = () => {
      focused = false
      sync()
    }
    anchor.addEventListener('pointerenter', enter)
    anchor.addEventListener('pointerleave', leave)
    anchor.addEventListener('focus', focus)
    anchor.addEventListener('blur', blur)
    return () => {
      anchor.removeEventListener('pointerenter', enter)
      anchor.removeEventListener('pointerleave', leave)
      anchor.removeEventListener('focus', focus)
      anchor.removeEventListener('blur', blur)
    }
  }, [])

  // While shown: place it before the first paint, then keep it placed.
  useLayoutEffect(() => {
    const marker = markerRef.current
    const anchor = marker?.parentElement
    const chip = chipRef.current
    if (!active || !marker || !anchor || !chip) return
    const clip = clippingAncestor(anchor)
    const update = () => {
      const quiet = !anchor.isConnected || anchor.matches(':disabled') || getComputedStyle(marker).display === 'none'
      if (quiet) {
        chip.style.display = 'none'
        return
      }
      chip.style.display = ''
      const p = placeLabel({
        anchor: anchor.getBoundingClientRect(),
        size: { width: chip.offsetWidth, height: chip.offsetHeight },
        viewport: { width: document.documentElement.clientWidth || window.innerWidth, height: document.documentElement.clientHeight || window.innerHeight },
        clip: clip?.getBoundingClientRect() ?? null,
        side,
        align,
      })
      chip.style.top = `${p.top}px`
      chip.style.left = `${p.left}px`
      chip.dataset.placed = p.side
      if (!p.visible) chip.style.display = 'none'
    }
    update()
    let frame = 0
    const loop = () => {
      update()
      frame = requestAnimationFrame(loop)
    }
    if (typeof requestAnimationFrame === 'function') frame = requestAnimationFrame(loop)
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      if (frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [active, side, align])

  return (
    <>
      <span ref={markerRef} aria-hidden="true" data-side={side} data-align={align} className="pointer-events-none absolute left-0 top-0 h-0 w-0 overflow-hidden" />
      {active
        ? createPortal(
            <span ref={chipRef} aria-hidden="true" data-hover-label="" className={CHIP}>
              {label}
            </span>,
            document.body,
          )
        : null}
    </>
  )
}

export function RowIcon({
  icon,
  label,
  variant = 'faint',
  labelSide = 'bottom',
  labelAlign = 'center',
  size = 'md',
  tone,
  href,
  onClick,
  disabled = false,
  ref,
  className,
}: RowIconProps) {
  const box = variant === 'boxed' ? BOX[size] : null
  const cls = cx(
    'relative inline-flex flex-none items-center justify-center outline-hidden transition-[opacity,color,background-color] duration-150',
    // `outline-solid` under the SAME variant, or no ring ever paints: in Tailwind v4
    // `outline-hidden` sets --tw-outline-style:none and `outline-2` reads that variable
    // (tests/components/manager-tools/shared/focus-rings.test.tsx).
    'focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
    VARIANT[variant],
    box?.cls,
    TONE[tone ?? (icon === 'plus' ? 'accent' : 'default')],
    'disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-ink-muted',
    className,
  )
  const inner = (
    <>
      <Icon name={icon} size={box?.glyph ?? 20} />
      <HoverLabel label={label} side={labelSide} align={labelAlign} />
    </>
  )
  if (href) {
    return (
      <a href={href} aria-label={label} className={cls}>
        {inner}
      </a>
    )
  }
  return (
    <button ref={ref} type="button" aria-label={label} onClick={onClick} disabled={disabled} className={cls}>
      {inner}
    </button>
  )
}
