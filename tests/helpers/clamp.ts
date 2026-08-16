/**
 * Parsers for the fluid size vocabulary, shared by every suite that reasons about the
 * scale. Four files had each hand-rolled one, and two of the regexes had already drifted
 * (`rem\)` vs `rem\)\]$`) — same smell as hand-listed fixtures, one layer down.
 *
 * TWO SPELLINGS, one meaning. A step used to BE its class (`text-[clamp(…)]`); since the
 * CSS-variable migration of 2026-08-16 it is a value token (`size-[48px]`) that the bridge
 * turns into the very same clamp. Both are resolved here, so the suites that pin fluidity,
 * ascent and desktop-size go on measuring what RENDERS rather than how it is spelled — a
 * test reading the token as a literal would pass while every headline was fixed-size again.
 */
import { sizeLength } from '@samfox1/site-bridge/styles'

/** A step's value as the CSS length it produces. A value token resolves through the
 *  bridge; anything else is already its own CSS and passes through. */
export const stepCss = (value: string): string => {
  const m = /^size-\[(\d+)px\]$/.exec(value)
  return m ? sizeLength(Number(m[1])) : value
}
const asLength = stepCss

/** The DESKTOP size of a fluid step — the clamp's max, in rem. NaN when not a clamp,
 *  so an assertion on a non-size value fails loudly instead of comparing undefined.
 *  A clamp maxing in px (the derived off-ladder shape) converts, since the whole point
 *  is one comparable number. */
export const clampMaxRem = (value: string): number => {
  const css = asLength(value)
  const rem = /,\s*([\d.]+)rem\)\]?$/.exec(css)
  if (rem) return Number(rem[1])
  const px = /,\s*([\d.]+)px\)\]?$/.exec(css)
  return Number(px ? Number(px[1]) / 16 : NaN)
}

/** The PHONE floor — the clamp's min, in rem. */
export const clampMinRem = (value: string): number => {
  const css = asLength(value)
  const rem = /clamp\(([\d.]+)rem/.exec(css)
  if (rem) return Number(rem[1])
  const px = /clamp\(([\d.]+)px/.exec(css)
  return Number(px ? Number(px[1]) / 16 : NaN)
}
