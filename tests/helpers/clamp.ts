/**
 * Parsers for the fluid size vocabulary (`text-[clamp(min,vw,max)]`), shared by every
 * suite that reasons about the scale. Four files had each hand-rolled one, and two of
 * the regexes had already drifted (`rem\)` vs `rem\)\]$`) — same smell as hand-listed
 * fixtures, one layer down.
 */

/** The DESKTOP size of a fluid step — the clamp's max, in rem. NaN when not a clamp,
 *  so an assertion on a non-size value fails loudly instead of comparing undefined. */
export const clampMaxRem = (value: string): number =>
  Number(/,\s*([\d.]+)rem\)\]?$/.exec(value)?.[1] ?? NaN)

/** The PHONE floor — the clamp's min, in rem. */
export const clampMinRem = (value: string): number =>
  Number(/clamp\(([\d.]+)rem/.exec(value)?.[1] ?? NaN)
