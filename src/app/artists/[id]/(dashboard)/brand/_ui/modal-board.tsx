import type { CSSProperties, ReactNode } from 'react'
import { cx } from '@/lib/cx'
import { HoverLabel } from './row-icon'

/** A brand colour offered as a board background. `key` must be unique among swatches and
 *  must not be one of BOARD_BACKGROUNDS' keys. */
export type BoardSwatch = { key: string; name: string; hex: string }

/** The three backgrounds every logo board offers, in order, before the brand colours. */
export const BOARD_BACKGROUNDS = [
  { key: 'transparent', name: 'Transparent', hex: null },
  { key: 'light', name: 'Light', hex: '#ffffff' },
  { key: 'dark', name: 'Dark', hex: '#111111' },
] as const

/** Only a clean six-digit hex reaches a style. A colour name comes from the database and
 *  is shown as text; its hex is the one value here that is written into CSS. */
const HEX = /^#[0-9a-f]{6}$/i

/** The prototype's board checkerboard: 20px squares of #e6e6e6 on white. */
const CHECKER: CSSProperties = {
  backgroundColor: '#ffffff',
  backgroundImage:
    'linear-gradient(45deg,#e6e6e6 25%,transparent 25%),linear-gradient(-45deg,#e6e6e6 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#e6e6e6 75%),linear-gradient(-45deg,transparent 75%,#e6e6e6 75%)',
  backgroundSize: '20px 20px',
  backgroundPosition: '0 0,0 10px,10px -10px,-10px 0',
}
/** The same pattern at circle size (8px squares). */
const CHECKER_SMALL: CSSProperties = {
  ...CHECKER,
  backgroundImage: CHECKER.backgroundImage!.replaceAll('#e6e6e6', '#d9d9d9'),
  backgroundSize: '8px 8px',
  backgroundPosition: '0 0,0 4px,4px -4px,-4px 0',
}

/**
 * THE LOGO BOARD (Sam, 2026-09-23, BRAND_PAGE_PLAN.md): a 320px square showing the thing
 * on a checkerboard; under it, centred, background circles — Transparent · Light · Dark ·
 * one per brand colour, each named in a hover label ABOVE it (below would run into the
 * modal's edge). Controlled: `value` is the circle that is on, `onChange` asks for another.
 * Trying a background is not a change and saves nothing.
 */
export function ModalBoard({
  value,
  onChange,
  swatches = [],
  backgrounds = true,
  start,
  end,
  children,
}: {
  /** The background's key: 'transparent' | 'light' | 'dark' | a swatch's key. */
  value: string
  onChange: (key: string) => void
  /** The artist's brand colours, by name. Any without a clean hex are left out. */
  swatches?: BoardSwatch[]
  /** false drops the circles (the Tab icon editor needs none). */
  backgrounds?: boolean
  /** What sits on the board: the logo, the icon. */
  children?: ReactNode
  /** A control under the board's bottom-left corner (Sam, 2026-09-23: "+ … bottom left"). */
  start?: ReactNode
  /** A control under the board's bottom-right corner (the trash). */
  end?: ReactNode
}) {
  const options = [...BOARD_BACKGROUNDS.map((b) => ({ key: b.key, name: b.name, hex: b.hex as string | null })), ...swatches.filter((s) => HEX.test(s.hex))]
  const current = options.find((o) => o.key === value) ?? options[0]
  const surface: CSSProperties = current.hex ? { backgroundColor: current.hex, borderColor: current.key === 'light' ? undefined : current.hex } : CHECKER

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        data-board=""
        data-bg={current.key}
        style={surface}
        className="grid h-[320px] w-[320px] max-w-full place-items-center overflow-hidden rounded-[14px] border border-hairline"
      >
        {children}
      </div>
      {backgrounds || start || end ? (
      <div data-board-bar="" className="grid w-[320px] max-w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
        <div className="flex justify-start">{start}</div>
        {backgrounds ? (
        <div role="group" aria-label="Background" className="flex flex-wrap justify-center gap-2.5">
          {options.map((o) => {
            const on = o.key === current.key
            return (
              <button
                key={o.key}
                type="button"
                aria-label={o.name}
                aria-pressed={on}
                onClick={() => onChange(o.key)}
                style={o.hex ? { backgroundColor: o.hex } : CHECKER_SMALL}
                className={cx(
                  'relative h-6 w-6 rounded-full border border-hairline',
                  // The chosen circle is ringed in ink, always; the rest ring on keyboard focus.
                  // Never `outline-hidden`/`outline-none` beside a ring: in Tailwind v4 they set
                  // --tw-outline-style:none, which `outline-2` reads — so each ring says
                  // `outline-solid` itself (tests/components/brand/focus-rings.test.tsx).
                  on
                    ? 'outline-solid outline-2 outline-offset-2 outline-ink'
                    : 'outline-hidden focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                )}
              >
                <HoverLabel label={o.name} side="top" />
              </button>
            )
          })}
        </div>
        ) : <div />}
        <div className="flex justify-end">{end}</div>
      </div>
      ) : null}
    </div>
  )
}
