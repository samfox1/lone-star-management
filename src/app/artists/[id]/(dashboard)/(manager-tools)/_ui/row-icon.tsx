'use client'

import { useEffect, useLayoutEffect, useRef, useState, type MouseEventHandler, type Ref } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { Icon, type IconName } from '@/components/ui/icons'
import { EDIT_GLYPH, ICON_BOLD } from '@/components/ui/icon-hover'
import { cx } from '@/lib/cx'
import { placeLabel, type LabelAlign } from './label-placement'
import { FOCUS_RING_OFFSET, REVEAL_ON_HOVER } from './styles'

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
  /** A row action: 40% until its LedgerRow is hovered (or it is focused). A pencil: hidden
   *  until then (`reveal`). A 32px box, whatever the glyph. */
  | 'faint'
  /** The empty state's one action (+): full ink, and a blue focus ring, because focus
   *  lands here after the note (Enter) and the manager must see where it went. */
  | 'primary'
  /** A modal action's glyph (the logo and tab-icon editors, Subscribers' search and CSV, the
   *  share-image picker's ✓): a 44px or 36px TARGET with no box drawn (Sam, 2026-10-02: no icons
   *  in a box; the border went 2026-10-05). Muted at rest; hover is colour and stroke only. */
  | 'boxed'
  /** A BARE GLYPH (Sam dislikes icons in a box): ink, no padding, no background. The AI test's
   *  "what to do" ↗ / pencil / wrench at the end of a sentence, and the Profiles cards' actions.
   *  Callers place it (`className`) and size it (`glyphSize`). Its tones are every variant's. */
  | 'bare'

export type RowIconProps = {
  icon: IconName
  /** Accessible name AND the hover label, e.g. "Change font". */
  label: string
  variant?: RowIconVariant
  /** Where the hover label opens. `top` for controls at the bottom of a modal. */
  labelSide?: 'bottom' | 'top'
  /** How the hover label lines up with the control. `end` for a control at a right edge. */
  labelAlign?: HoverLabelAlign
  /** `boxed` only: a 44px (modal actions) or 36px (search, CSV, a picker's ✓) target. */
  size?: 'md' | 'sm'
  /** Hover colour. `default`: ink (Sam, 2026-10-02: "black and bold"). `accent` for ✓ and
   *  every +, `danger` for × and trash. A `plus` icon is `accent` unless told otherwise (Sam,
   *  2026-09-23: every + turns blue, as the trash turns red). `link`: blue on hover only, not on
   *  keyboard focus. Every tone also thickens the stroke (ICON_BOLD), and none draws a box. */
  tone?: 'default' | 'accent' | 'danger' | 'link'
  /** The glyph's size in px. Default: 20, or the boxed size's own. Ignored for `edit`: every
   *  pencil is EDIT_GLYPH (14px, Sam 2026-10-02: "these edit icons should be smaller across"). */
  glyphSize?: number
  /** Hidden until the pointer is on the thing it edits (its `EDIT_TARGET`, styles.ts), or on
   *  it; shown on keyboard focus and on a touch screen. Default: on for every `edit` pencil
   *  (Sam, 2026-10-02: "it should only show when needed"), off for every other glyph. */
  reveal?: boolean
  /** A real link instead of a button (the brand-kit download). */
  href?: string
  /** How `href` opens: `app`, a page of this app (next/link); `external`, another site in a
   *  new tab. Unset: a plain link (a download, a mailto:). */
  link?: 'app' | 'external'
  /** A plain link's file name: the browser saves it rather than opening it. */
  download?: string
  onClick?: MouseEventHandler<HTMLButtonElement>
  disabled?: boolean
  /** The button, so a NoteField's Enter can move focus here. */
  ref?: Ref<HTMLButtonElement>
  className?: string
}

/** The hover colour of each tone. The stroke half (ICON_BOLD) is added once, for every tone:
 *  black-and-bold for the default, blue-and-bold for a +, red-and-bold for a trash. */
const TONE: Record<NonNullable<RowIconProps['tone']>, string> = {
  default: 'hover:text-ink',
  // Keyboard focus too: the + is where focus lands after a note's Enter.
  accent: 'hover:text-accent focus-visible:text-accent',
  danger: 'hover:text-accent-red',
  link: 'hover:text-accent',
}

const VARIANT: Record<RowIconVariant, string> = {
  // The row is `group/ledger` (ledger.tsx). Its own hover and keyboard focus light it too,
  // so it is never a control that only a mouse over the row can find.
  // Its rest opacity is RowIcon's: 40%, or 0 for a pencil (`reveal`). cx joins, it doesn't
  // resolve a clash, so the two never sit in one class list.
  // h-8 w-8: the 32px a 20px glyph and p-1.5 made, now fixed, so a 14px pencil keeps it.
  faint: 'h-8 w-8 rounded-lg text-ink-muted hover:opacity-100 focus-visible:opacity-100 group-hover/ledger:opacity-100',
  primary: 'h-8 w-8 rounded-lg text-ink',
  boxed: 'rounded-xl text-ink-muted',
  bare: '',
}

/** The bare glyph, whole: its own transition and disabled look, none of the boxed base's
 *  centring or padding (test-row.tsx's and the Profiles cards' glyphs, as they were drawn). */
const BARE = cx('relative inline-flex rounded text-ink transition-[opacity,color] disabled:cursor-default disabled:opacity-40 disabled:hover:text-ink', FOCUS_RING_OFFSET)

/** A bare pencil is only 14px: on a touch screen an invisible ring makes it a 28px target
 *  without taking any room (a later sibling still paints over it, so it never steals a tap). */
const TOUCH_SLOP = "pointer-coarse:before:absolute pointer-coarse:before:-inset-[7px] pointer-coarse:before:content-['']"

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
  glyphSize,
  reveal = icon === 'edit',
  href,
  link,
  download,
  onClick,
  disabled = false,
  ref,
  className,
}: RowIconProps) {
  const box = variant === 'boxed' ? BOX[size] : null
  const toned = tone ?? (icon === 'plus' ? 'accent' : 'default')
  const cls =
    variant === 'bare'
      ? cx(BARE, TONE[toned], ICON_BOLD, icon === 'edit' && TOUCH_SLOP, reveal && REVEAL_ON_HOVER, className)
      : cx(
          'relative inline-flex flex-none items-center justify-center transition-[opacity,color] duration-150',
          // The shared keyboard ring (focus-ring.ts), which says why it needs its own `outline-solid`.
          FOCUS_RING_OFFSET,
          VARIANT[variant],
          variant === 'faint' && !reveal && 'opacity-40',
          reveal && REVEAL_ON_HOVER,
          box?.cls,
          TONE[toned],
          ICON_BOLD,
          'disabled:cursor-default disabled:opacity-35 disabled:hover:text-ink-muted',
          className,
        )
  const inner = (
    <>
      <Icon name={icon} size={icon === 'edit' ? EDIT_GLYPH : (glyphSize ?? box?.glyph ?? 20)} />
      <HoverLabel label={label} side={labelSide} align={labelAlign} />
    </>
  )
  if (href && link === 'app') {
    return (
      <Link href={href} aria-label={label} className={cls}>
        {inner}
      </Link>
    )
  }
  if (href && link === 'external') {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" aria-label={label} className={cls}>
        {inner}
      </a>
    )
  }
  if (href) {
    return (
      <a href={href} download={download} aria-label={label} className={cls}>
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
