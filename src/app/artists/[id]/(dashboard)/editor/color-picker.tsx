import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'
import { canonicalHex, clamp, contrastInk, fractionAt, hexToHsv, hsvToHex, hueHex, normalizeHex } from '@/lib/color'
import { modalOverlayClass } from '@/components/ui/ui'
import { CONTROL_LABEL } from './inspector-shared'

/**
 * The colour control. In the panel it is ONE row — clear, the current colour, the hex, and
 * a palette button — because it sits among a dozen other controls and height there is the
 * scarce thing. The palette button opens a small modal holding the mixing surface: a
 * saturation × brightness square over a hue slider, any of the ~16.7M sRGB colours. A fixed
 * shortlist of presets was the first cut and it was wrong: an artist's site has its own
 * colours, and one we invented would never be among them. The site's real palette is the
 * swatch row under the panel row, which settles most picks without opening anything.
 *
 * Hue lives in COMPONENT state, not in the hex. Deriving it back from the colour would
 * snap the slider to red every time the manager dragged brightness to black (black has no
 * hue), so the square keeps painting in the hue the manager chose. `emitted` guards the
 * same edge on the other side: our own emissions must not re-seed the drag position, or
 * the handle would jump under the pointer as 8-bit rounding rewrote what we sent.
 *
 * Keyboard-reachable throughout: the hue is a native range, the square is an arrow-key
 * 2-D slider, and the hex field takes an exact value typed or pasted. The square's maths
 * is `lib/color.ts` — jsdom reports every element as zero-sized, so geometry that must be
 * verified lives in pure functions, not in here.
 *
 * TWO PRESENTATIONS, ONE CONTROL (the standing rule: every colour control is this one).
 * `variant="panel"` is the inspector row above. `variant="row"` is the Brand page's
 * (BRAND_PAGE_PLAN.md): swatch + hex on the row, and the same square, hue and swatches in a
 * site-styled panel that opens to the LEFT of the swatch (`rowPanelSide`). Inside the editor,
 * `BrandSwatchProvider` puts the artist's brand colours first in every swatch row, by name.
 */

/** One arrow-key step across the square, as a fraction of its width/height. Shift is 5×. */
const KEY_STEP = 0.02

/**
 * The mixing surface, lifted out of the panel into a small modal.
 *
 * Deliberately NARROW (320px): the manager is judging a colour against the site behind
 * it, so the dialog covers as little of the frame as it can while still giving the square
 * enough room to aim in. Edits apply live through the same `onChange` as everything else,
 * so there is nothing to confirm — closing is the only action, by Escape, the backdrop, or
 * Save.
 */
function ColorModal({
  aria,
  label,
  value,
  current,
  onClose,
  children,
}: {
  aria: string
  label: string
  value: string
  /** The colour as it stands, for the header chip. */
  current: string
  onClose: () => void
  children: React.ReactNode
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${aria} palette`}
      className={modalOverlayClass}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      {/* The card class is spelled out rather than composed from `modalCardClass`: `cx` is a
          plain join, so a narrower `w-` alongside its `w-[560px]` loses on Tailwind's own
          rule order, not on the order written here. */}
      <div className="flex max-h-[88vh] w-[320px] max-w-full flex-col gap-3 overflow-auto rounded-2xl bg-paper p-5 shadow-2xl">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="h-6 w-6 flex-none rounded-md border border-hairline"
            style={value ? { backgroundColor: current } : NO_COLOR_SWATCH}
          />
          <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-[-0.01em]">{label}</h2>
          <span className="flex-none font-space text-[11px] text-ink-muted">{value || 'None'}</span>
        </div>
        {children}
        <button
          type="button"
          onClick={onClose}
          className="mt-1 w-full rounded-lg border border-hairline px-3 py-2 font-space text-[11px] font-bold uppercase tracking-[0.06em] text-ink transition-colors hover:border-accent hover:text-accent"
        >
          Save
        </button>
      </div>
    </div>
  )
}

/**
 * How a swatch draws "no colour set".
 *
 * NOT `transparent`. An empty square on the panel's white paper is indistinguishable from
 * one someone painted white, so the picker was reporting a choice nobody had made — Sam
 * read skeen's undeclared footer background as "said to be the white" (2026-08-15). A
 * diagonal rule is the conventional mark for none, and it cannot be mistaken for a colour.
 */
const NO_COLOR_SWATCH: React.CSSProperties = {
  backgroundImage:
    'linear-gradient(to top right, transparent calc(50% - 0.5px), var(--color-accent-red, #c4403a) calc(50% - 0.5px), var(--color-accent-red, #c4403a) calc(50% + 0.5px), transparent calc(50% + 0.5px))',
}

/**
 * THE ARTIST'S BRAND COLOURS, FIRST, BY NAME (BRAND_PAGE_PLAN.md, Colors tab).
 *
 * Every swatch row in the site editor is a ColorPalette, and five panels feed it `used`
 * from `siteSwatches`. The brand colours reach all of them through this one provider,
 * which the editor shell mounts around the inspector — not a prop threaded through every
 * panel, where the one panel that forgot it would quietly offer the site's colours only.
 * Outside a provider (the Brand page itself, every existing test) nothing changes.
 */
export type NamedSwatch = { name: string; hex: string }
/** One swatch as the palette draws it: a hex, and a name when it is a brand colour. */
export type Swatch = { hex: string; name?: string }

const BrandSwatches = createContext<readonly NamedSwatch[]>([])

export function BrandSwatchProvider({ colors, children }: { colors: readonly NamedSwatch[]; children: ReactNode }) {
  return <BrandSwatches.Provider value={colors}>{children}</BrandSwatches.Provider>
}

/**
 * The swatch row: the brand colours first (named), then the site's own colours that are
 * not already among them. One swatch per colour — `#F4F1EA` and `#f4f1ea` are the same —
 * and when two brand colours share a hex, the first one's name is kept. A value that is
 * not a hex never reaches a style.
 */
export function mergeSwatches(brand: readonly NamedSwatch[], used: readonly string[]): Swatch[] {
  const out: Swatch[] = []
  const seen = new Set<string>()
  const push = (raw: string, name?: string) => {
    const hex = canonicalHex(raw)
    if (!hex || seen.has(hex)) return
    seen.add(hex)
    out.push(name === undefined ? { hex } : { hex, name })
  }
  for (const b of brand) push(b.hex, b.name)
  for (const u of used) push(u)
  return out
}

/** The Brand row's panel: its width, its gap from the swatch, and the page gutter it
 *  must keep clear of. */
const ROW_PANEL_WIDTH = 232
const ROW_PANEL_GAP = 12
const PAGE_GUTTER = 16

/**
 * Where the Brand row's panel opens (Sam, 2026-09-23: "to the left, never over the row").
 * LEFT of the swatch whenever the panel, its gap and the page gutter fit before it — its
 * right edge then sits 12px short of the swatch, so it can cover neither the swatch nor
 * the hex beside it. When they do not fit (below 900px the ledger stacks and the swatch
 * sits at the left edge), it opens BELOW instead of off the screen. Measured at open time,
 * not from a breakpoint, so any container gets the honest answer.
 *
 * Vertically, a left panel is TOP-ALIGNED with the swatch and grows down — anchored to its
 * own row. It was centred on the swatch, and a ~280px panel centred on a ~64px row reaches
 * ~110px up: the Browser bar's covered the Home-screen icon's tile in the row above (Sam's
 * screenshot, 2026-09-23). Down is where a ledger has room: the rows below are the ones
 * still to come, and the last row has only page beneath it.
 */
export function rowPanelSide(anchorLeft: number): 'left' | 'below' {
  return anchorLeft >= ROW_PANEL_WIDTH + ROW_PANEL_GAP + PAGE_GUTTER ? 'left' : 'below'
}

/** The row variant's empty state, drawn by the caller. A component rather than a call in
 *  the render, so `open` reaches it as a prop — the way a handler reaches any button —
 *  and is only ever called from the caller's click. */
function EmptyState({ render, open }: { render: (open: () => void) => ReactNode; open: () => void }) {
  return <>{render(open)}</>
}

export function ColorPalette({
  label,
  aria,
  value,
  used = [],
  fallbackHex,
  onChange,
  variant = 'panel',
  renderEmpty,
}: {
  label: string
  /** Prefix for every aria-label in the group ("Slot 1 Border color"). */
  aria: string
  /** The current hex, '' when no colour is set. */
  value: string
  /** What the element ACTUALLY shows when nothing is set here — the site's own default
   *  for this channel. Most regions never declare a colour; they inherit one, and the
   *  swatch used to answer that with a "no colour" mark, so a site that is plainly cream
   *  on black read as a panel full of blanks (Sam, 2026-08-15). With this the swatch shows
   *  what is on screen and the label still says Default, which is both true at once. */
  fallbackHex?: string
  /** Colours already used elsewhere on this site, most-used first. Offered as one-click
   *  swatches so a manager can match what they picked before instead of re-deriving the
   *  hex by eye — the palette is precise, but on its own it does nothing for consistency. */
  used?: string[]
  /** Apply a hex, or '' to clear it. */
  onChange: (hex: string) => void
  /**
   * `panel` (the default): the site editor's inspector row — clear, swatch, hex — with the
   * mixer in a small modal. `row`: the Brand page's row (BRAND_PAGE_PLAN.md) — a swatch and
   * a hex on the row, and the site-styled panel ("On the site" swatches, the shade square,
   * the hue bar, a hex box) opening to the LEFT of the swatch (`rowPanelSide`). A brand
   * colour always has one, so the row variant has no clear and never sends ''.
   */
  variant?: 'panel' | 'row'
  /** Row variant, while `value` is '': what the row shows in place of the swatch and hex
   *  (the Brand page's "No color yet" and its +). `open` toggles the panel. The first
   *  colour replaces it AT ONCE, panel open or not — except mid-drag (see `held`). */
  renderEmpty?: (open: () => void) => ReactNode
}) {
  const brand = useContext(BrandSwatches)
  const swatches = mergeSwatches(brand, used)
  const isRow = variant === 'row'
  const seed = hexToHsv(value)
  const [hue, setHue] = useState(seed?.h ?? 0)
  const [sat, setSat] = useState(seed ? seed.s : 1)
  const [val, setVal] = useState(seed ? seed.v : 1)
  const [text, setText] = useState(value)
  /** Is the mixing surface (square + hue) showing? Collapsed by default — see the row below. */
  const [open, setOpen] = useState(false)
  // Stable, so the modal's document-level Escape listener attaches once per open rather
  // than re-registering on every keystroke and drag frame.
  const closeModal = useCallback(() => setOpen(false), [])
  /** The last hex WE sent up — so the round trip back through `value` isn't mistaken for an
   *  outside edit and doesn't re-seed the handle mid-drag. State, not a ref: it is read
   *  during render, and both updates land in the same batch as the `onChange` that caused
   *  the new `value`, so the check below always sees the matching pair. */
  const [emitted, setEmitted] = useState(value)

  /** Move the square/slider handles to a hex. Grey has no hue to read, so the slider
   *  keeps the hue the manager picked; a non-hex ('' from clear) moves nothing. */
  const seedFrom = useCallback((hex: string) => {
    const hsv = hexToHsv(hex)
    if (!hsv) return
    if (hsv.s > 0 && hsv.v > 0) setHue(hsv.h)
    setSat(hsv.s)
    setVal(hsv.v)
  }, [])

  /** Apply a hex ('' clears): remember it as ours, mirror it into the field, move the
   *  handles to it, and send it up. Every non-drag apply path routes through here so the
   *  four steps can't drift apart per call site. */
  const applyHex = (hex: string) => {
    setEmitted(hex)
    setText(hex)
    seedFrom(hex)
    onChange(hex)
  }

  // Re-seed from an outside change (a Revert, a different item), never from our own.
  const [seenValue, setSeenValue] = useState(value)
  if (seenValue !== value) {
    setSeenValue(value)
    setText(value)
    if (value !== emitted) seedFrom(value)
  }

  const emit = useCallback(
    (h: number, s: number, v: number) => {
      const hex = hsvToHex({ h, s, v })
      setEmitted(hex)
      setText(hex)
      onChange(hex)
    },
    [onChange],
  )

  const areaRef = useRef<HTMLDivElement>(null)
  /** The square's box, measured ONCE on pointerdown — it can't move mid-drag, and
   *  measuring per move is a forced layout read at pointer rate. */
  const dragRect = useRef<DOMRect | null>(null)
  // Drag state, not a ref: the window listeners attach in an effect, and an effect keyed
  // on a ref would never run when a press happens to land on the current colour (React
  // bails out of the re-render, and the drag would silently do nothing after the press).
  const [dragging, setDragging] = useState(false)

  /** Read a pointer position as saturation (x) × brightness (y, inverted: bright at top). */
  const dragTo = useCallback(
    (clientX: number, clientY: number) => {
      const r = dragRect.current ?? areaRef.current?.getBoundingClientRect()
      if (!r) return
      const s = fractionAt(clientX, r.left, r.width)
      const v = 1 - fractionAt(clientY, r.top, r.height)
      setSat(s)
      setVal(v)
      emit(hue, s, v)
    },
    [emit, hue],
  )
  // The move handler reads dragTo through a ref so the window listeners attach once per
  // drag instead of being torn down and re-added on every emitted colour change.
  const dragToRef = useRef(dragTo)
  useEffect(() => {
    dragToRef.current = dragTo
  })

  // The drag continues over the whole window: the pointer routinely leaves the square,
  // and a colour that stopped changing at the edge would feel broken. Listeners are only
  // attached while dragging, and always torn down.
  useEffect(() => {
    if (!dragging) return
    const move = (e: PointerEvent) => dragToRef.current(e.clientX, e.clientY)
    const up = () => setDragging(false)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      dragRect.current = null
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [dragging])

  function onAreaKeyDown(e: React.KeyboardEvent) {
    const step = e.shiftKey ? KEY_STEP * 5 : KEY_STEP
    let s = sat
    let v = val
    if (e.key === 'ArrowLeft') s -= step
    else if (e.key === 'ArrowRight') s += step
    else if (e.key === 'ArrowUp') v += step
    else if (e.key === 'ArrowDown') v -= step
    else if (e.key === 'Home') s = 0
    else if (e.key === 'End') s = 1
    else return
    e.preventDefault()
    s = clamp(s, 0, 1)
    v = clamp(v, 0, 1)
    setSat(s)
    setVal(v)
    emit(hue, s, v)
  }

  /** Commit the hex field: a valid hex applies, an empty field clears, anything else is
   *  left alone (so a half-typed value isn't destroyed by a blur). The row variant has no
   *  "none", so an empty field there puts the colour back instead. */
  function commitText() {
    const clean = normalizeHex(text)
    if (clean) applyHex(clean)
    else if (text.trim() === '' && !isRow) applyHex('')
    else setText(value)
  }

  /* ── The row variant's panel: where it opens, and what closes it ── */
  const anchorRef = useRef<HTMLDivElement>(null)
  const [side, setSide] = useState<'left' | 'below'>('left')
  /** Opened from the empty state, and still showing it (see below). */
  const [openedEmpty, setOpenedEmpty] = useState(false)
  /**
   * A pointer went down in the panel and has not come up: a drag on the square or the hue.
   *
   * THE FIRST COLOUR SHOWS AT ONCE (Sam, 2026-09-23: after a hex saved with the panel open,
   * the row still said "No color yet +" until it closed). The empty state held for the
   * whole open panel so the anchor would not change size under a pick — but the only pick
   * that matters is a DRAG: swapping "No color yet +" for the swatch moves the anchor, the
   * panel moves with it, and the square or hue bar would slide out from under the pointer
   * (the square keeps the box it measured at pointerdown; a native range re-reads its own).
   * So the swap waits only while a gesture that started in the panel is down, and happens
   * when it lets go. Typed hexes, swatch clicks and keyboard steps swap immediately.
   */
  const [held, setHeld] = useState(false)
  // Once the row has its colour and no gesture is holding it, it stays swapped: a second
  // drag must not bring "No color yet" back. (Render-time, like `seenValue` above.)
  if (openedEmpty && value !== '' && !held) setOpenedEmpty(false)
  /** Hand focus back to the trigger once the panel has closed (Escape, a swatch pick). */
  const refocus = useRef(false)

  const toggleRowPanel = () => {
    if (open) {
      setOpen(false)
      return
    }
    setSide(rowPanelSide(anchorRef.current?.getBoundingClientRect().left ?? 0))
    setOpenedEmpty(value === '')
    setOpen(true)
  }
  const closeRowPanel = (returnFocus: boolean) => {
    refocus.current = returnFocus
    setOpen(false)
  }

  // A press anywhere outside the swatch and its panel closes it — the panel is non-modal,
  // so the page behind stays usable and a click elsewhere is the natural way out.
  useEffect(() => {
    if (!isRow || !open) return
    const onDown = (e: Event) => {
      if (anchorRef.current && !anchorRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [isRow, open])

  // The gesture ends wherever the pointer lets go — usually outside the panel.
  useEffect(() => {
    if (!held) return
    const up = () => setHeld(false)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [held])

  // After the close has rendered, so the trigger that gets focus is the one now showing
  // (the swatch, when the panel was opened from the empty state and a colour was picked).
  useEffect(() => {
    if (open || !refocus.current) return
    refocus.current = false
    anchorRef.current?.querySelector<HTMLElement>('button')?.focus()
  }, [open])

  const mixed = hsvToHex({ h: hue, s: sat, v: val })
  const current = value || mixed
  const handleInk = contrastInk(mixed)
  const activeHex = canonicalHex(value)

  /** The mixing surface both variants share: saturation (→) × brightness (↑) over the
   *  hue, then the hue itself. White-to-transparent over the hue, then a
   *  transparent-to-black wash on top: the standard HSV square. */
  const mixer = (squareHeight: string, hueSpacing: string) => (
    <>
      <div
        ref={areaRef}
        role="slider"
        tabIndex={0}
        aria-label={`${aria} saturation and brightness`}
        aria-valuetext={`${Math.round(sat * 100)}% saturation, ${Math.round(val * 100)}% brightness`}
        aria-valuenow={Math.round(val * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        onKeyDown={onAreaKeyDown}
        onPointerDown={(e) => {
          dragRect.current = e.currentTarget.getBoundingClientRect()
          setDragging(true)
          e.currentTarget.setPointerCapture?.(e.pointerId) // absent in jsdom
          dragTo(e.clientX, e.clientY)
        }}
        style={{ backgroundColor: hueHex(hue) }}
        className={cx(
          'relative w-full cursor-crosshair touch-none rounded-lg ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-ink',
          squareHeight,
        )}
      >
        <div className="pointer-events-none absolute inset-0 rounded-lg bg-[linear-gradient(to_right,#ffffff,rgba(255,255,255,0))]" />
        <div className="pointer-events-none absolute inset-0 rounded-lg bg-[linear-gradient(to_top,#000000,rgba(0,0,0,0))]" />
        {/* The handle. Hidden when no colour is set — there is no position to claim. */}
        {value !== '' && (
          <span
            aria-hidden
            className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 shadow-[0_0_0_1px_rgba(0,0,0,0.25)]"
            style={{ left: `${sat * 100}%`, top: `${(1 - val) * 100}%`, borderColor: handleInk }}
          />
        )}
      </div>

      {/* Hue. A native range so it keeps arrow keys, Home/End and screen-reader support. */}
      <input
        type="range"
        min={0}
        max={359}
        value={Math.round(hue)}
        aria-label={`${aria} hue`}
        onChange={(e) => {
          const h = Number(e.target.value)
          setHue(h)
          emit(h, sat, val)
        }}
        style={{
          background:
            'linear-gradient(to right,#ff0000,#ffff00,#00ff00,#00ffff,#0000ff,#ff00ff,#ff0000)',
        }}
        className={cx(
          'h-3 w-full cursor-pointer appearance-none rounded-full outline-none',
          hueSpacing,
          '[&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-paper [&::-webkit-slider-thumb]:bg-transparent [&::-webkit-slider-thumb]:shadow-[0_0_0_1px_rgba(0,0,0,0.35)]',
          '[&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-paper [&::-moz-range-thumb]:bg-transparent',
        )}
      />
    </>
  )

  /** A swatch's accessible name and hover text: a brand colour by its name, any other by
   *  its hex. */
  const swatchName = (s: Swatch) => s.name ?? s.hex

  if (isRow) {
    const showEmpty = Boolean(renderEmpty) && (value === '' || (open && openedEmpty))
    const hexField = (fieldLabel: string, className: string) => (
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commitText}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commitText()
          }
        }}
        maxLength={7}
        aria-label={fieldLabel}
        spellCheck={false}
        className={cx(
          'rounded-lg border border-hairline bg-paper px-2.5 py-[7px] font-space text-[13px] uppercase text-ink outline-none focus:border-ink',
          className,
        )}
      />
    )
    return (
      <div
        className="flex items-center gap-2.5"
        onKeyDown={(e) => {
          if (e.key === 'Escape' && open) {
            e.preventDefault()
            e.stopPropagation() // Escape answers the panel, not a modal around the page
            closeRowPanel(true)
          }
        }}
      >
        {/* The anchor holds the trigger and the panel ONLY. The row's hex sits outside it,
            to the right, so a panel that ends left of the trigger can never cover it. */}
        {/* While the panel is open, the trigger's own hover label (a RowIcon's [data-side]
            child) is hidden: the panel opens beside it and cut the label off ("ick a color"),
            and an open panel has already said what the control does. */}
        <div
          ref={anchorRef}
          data-color-anchor=""
          className={cx('relative flex items-center gap-2.5', open && '[&>button>[data-side]]:hidden')}
        >
          {showEmpty ? (
            <EmptyState render={renderEmpty!} open={toggleRowPanel} />
          ) : (
            <button
              type="button"
              onClick={toggleRowPanel}
              aria-label={`${aria} palette`}
              aria-haspopup="dialog"
              aria-expanded={open}
              title="Pick a colour"
              style={value ? { backgroundColor: value } : NO_COLOR_SWATCH}
              // `outline-solid` under the same variant, or the ring never paints: Tailwind v4's
              // `outline-hidden` zeroes the style `outline-2` reads (brand/focus-rings.test.tsx).
              className="block h-8 w-8 flex-none rounded-[9px] border border-hairline outline-hidden focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            />
          )}
          {open && (
            <div
              role="dialog"
              aria-label={`${aria} palette`}
              data-side={side}
              onPointerDownCapture={() => setHeld(true)}
              className={cx(
                'absolute z-30 w-[232px] rounded-xl border border-hairline bg-paper p-3 text-left shadow-[0_12px_32px_rgba(0,0,0,0.08)]',
                side === 'left' ? 'right-[calc(100%+12px)] top-0' : 'left-0 top-[calc(100%+8px)]',
              )}
            >
              {/* The site's colours first: matching what is already there is the common
                  pick, and one click settles it (and closes the panel). Absent when the
                  site has none, since an empty grid is worse than no grid. */}
              {swatches.length > 0 && (
                <>
                  <p className="mb-2 font-space text-[10px] uppercase tracking-[0.1em] text-ink-faint">On the site</p>
                  <div className="mb-3 grid grid-cols-6 gap-1.5">
                    {swatches.map((s) => (
                      <button
                        key={s.hex}
                        type="button"
                        onClick={() => {
                          applyHex(s.hex)
                          closeRowPanel(true)
                        }}
                        aria-label={`${aria} ${swatchName(s)}`}
                        aria-pressed={activeHex === s.hex}
                        title={swatchName(s)}
                        style={{ backgroundColor: s.hex }}
                        // The picked colour's ring is always on, so it must not share the
                        // element with a hide at all; the others ring on keyboard focus.
                        className={cx(
                          'aspect-square rounded-[7px] border border-hairline',
                          activeHex === s.hex
                            ? 'outline-solid outline-2 outline-offset-1 outline-ink'
                            : 'outline-hidden focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
                        )}
                      />
                    ))}
                  </div>
                </>
              )}
              {mixer('h-[120px]', 'mb-3 mt-2.5')}
              {hexField('Hex', 'w-full')}
            </div>
          )}
        </div>
        {!showEmpty && hexField(`${aria} hex`, 'w-[92px]')}
      </div>
    )
  }

  return (
    <div className="py-1.5">
      <span className={CONTROL_LABEL}>{label}</span>

      {/* The panel row, and the only thing the panel spends height on: clear, the current
          colour, the exact hex, and the palette button. Mixing a colour is occasional and
          wants room, so it happens in a modal rather than pushing every control below it
          down the panel on every visit. Neither the clear nor the current-colour chip is
          boxed — a border around each would read as three competing controls. */}
      <div className="mt-1.5 flex items-center gap-2">
        <button
          type="button"
          onClick={() => applyHex('')}
          aria-label={`${aria} none`}
          aria-pressed={value === ''}
          title="No colour"
          className={cx(
            'flex-none rounded p-1 transition-colors',
            value === '' ? 'text-ink' : 'text-ink-faint hover:text-ink',
          )}
        >
          <Icon name="plus" size={12} className="rotate-45" />
        </button>
        {/* The colour as it stands, and the way into the palette. A hairline keeps it
            findable when it holds a pale colour or none at all — with no border, "no
            colour set" rendered as an invisible gap with nothing to click. */}
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`${aria} palette`}
          aria-haspopup="dialog"
          title="Pick a colour"
          style={value ? { backgroundColor: current } : fallbackHex ? { backgroundColor: fallbackHex } : NO_COLOR_SWATCH}
          className="h-6 w-6 flex-none rounded-md border border-hairline transition-shadow hover:ring-2 hover:ring-hairline"
        />
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commitText}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commitText()
            }
          }}
          placeholder="None"
          aria-label={`${aria} hex`}
          spellCheck={false}
          className="w-full min-w-0 rounded-md bg-surface px-2.5 py-1.5 font-space text-[12px] text-ink outline-none ring-1 ring-hairline placeholder:font-space placeholder:text-ink-faint focus:ring-ink-faint"
        />
      </div>

      {open && (
        <ColorModal
          aria={aria}
          label={label}
          value={value}
          current={current}
          onClose={closeModal}
        >
          {mixer('h-44', 'mt-3')}

          {/* The site's colours, under the mixer: the artist's BRAND colours first, by name
              (BrandSwatchProvider), then the site's declared palette, then anything else
              already used in its styles. This is what keeps a site in sync — one click,
              no hex to remember — and it sits where the manager is already choosing. Absent
              when there are none, since an empty row is worse than no row. */}
          {swatches.length > 0 && (
            <div className="mt-1">
              <span className={CONTROL_LABEL}>On site</span>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {swatches.map((s) => {
                  const active = activeHex === s.hex
                  return (
                    <button
                      key={s.hex}
                      type="button"
                      onClick={() => applyHex(s.hex)}
                      aria-label={`${aria} ${swatchName(s)}`}
                      aria-pressed={active}
                      title={swatchName(s)}
                      style={{ backgroundColor: s.hex }}
                      className={cx(
                        'h-6 w-6 rounded-md border border-hairline',
                        active && 'ring-2 ring-ink ring-offset-1',
                      )}
                    />
                  )
                })}
              </div>
            </div>
          )}
        </ColorModal>
      )}
    </div>
  )
}
