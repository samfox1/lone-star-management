import { useCallback, useEffect, useRef, useState } from 'react'
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
 * Done.
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
          <span aria-hidden className="h-6 w-6 flex-none rounded-md" style={{ backgroundColor: value ? current : 'transparent' }} />
          <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-[-0.01em]">{label}</h2>
          <span className="flex-none font-space text-[11px] text-ink-muted">{value || 'None'}</span>
        </div>
        {children}
        <button
          type="button"
          onClick={onClose}
          className="mt-1 w-full rounded-lg border border-hairline px-3 py-2 font-space text-[11px] font-bold uppercase tracking-[0.06em] text-ink-muted transition-colors hover:border-accent hover:text-accent"
        >
          Done
        </button>
      </div>
    </div>
  )
}

export function ColorPalette({
  label,
  aria,
  value,
  used = [],
  onChange,
}: {
  label: string
  /** Prefix for every aria-label in the group ("Slot 1 Border color"). */
  aria: string
  /** The current hex, '' when no colour is set. */
  value: string
  /** Colours already used elsewhere on this site, most-used first. Offered as one-click
   *  swatches so a manager can match what they picked before instead of re-deriving the
   *  hex by eye — the palette is precise, but on its own it does nothing for consistency. */
  used?: string[]
  /** Apply a hex, or '' to clear it. */
  onChange: (hex: string) => void
}) {
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
   *  left alone (so a half-typed value isn't destroyed by a blur). */
  function commitText() {
    const clean = normalizeHex(text)
    if (clean) applyHex(clean)
    else if (text.trim() === '') applyHex('')
    else setText(value)
  }

  const mixed = hsvToHex({ h: hue, s: sat, v: val })
  const current = value || mixed
  const handleInk = contrastInk(mixed)
  const activeHex = canonicalHex(value)

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
          style={{ backgroundColor: value ? current : 'transparent' }}
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
          {/* Saturation (→) × brightness (↑). White-to-transparent over the hue, then a
              transparent-to-black wash on top: the standard HSV square. */}
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
            className="relative h-44 w-full cursor-crosshair touch-none rounded-lg ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-ink"
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
              'mt-3 h-3 w-full cursor-pointer appearance-none rounded-full outline-none',
              '[&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-paper [&::-webkit-slider-thumb]:bg-transparent [&::-webkit-slider-thumb]:shadow-[0_0_0_1px_rgba(0,0,0,0.35)]',
              '[&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-paper [&::-moz-range-thumb]:bg-transparent',
            )}
          />

          {/* The site's colours, under the mixer: its declared palette first, then anything
              else already used in its styles. This is what keeps a site in sync — one click,
              no hex to remember — and it sits where the manager is already choosing. Absent
              when there are none, since an empty row is worse than no row. */}
          {used.length > 0 && (
            <div className="mt-1">
              <span className={CONTROL_LABEL}>On site</span>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {used.map((hex) => {
                  const active = activeHex === hex
                  return (
                    <button
                      key={hex}
                      type="button"
                      onClick={() => applyHex(hex)}
                      aria-label={`${aria} ${hex}`}
                      aria-pressed={active}
                      title={hex}
                      style={{ backgroundColor: hex }}
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
