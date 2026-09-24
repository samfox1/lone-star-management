import type { LogoAnalysis } from '@/lib/manager-tools/brand/image-checks'

/**
 * What the logo editor says after an upload (BRAND_PAGE_PLAN.md, Logos): low resolution, a
 * flat opaque background, a very large file — in plain words, no numbers. `flat` is the
 * one that comes with an action (the eraser, "Remove background"). `notFlat` is the plan's
 * "if the background isn't flat, say so instead of trying": an opaque logo whose edge is
 * not one colour gets a sentence and no eraser, because the cut-out would botch it.
 *
 * A logo that already has transparency gets no background sentence at all.
 */
export type LogoWarning = { key: 'flat' | 'notFlat' | 'lowRes' | 'huge'; text: string }

export const NOT_FLAT_TEXT = "This logo's background isn't one flat color, so it can't be removed here."

/** "white", "black", or "colored" — the box a manager will recognise, not a hex. */
function boxWord(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255]
  if (r >= 240 && g >= 240 && b >= 240) return 'white'
  if (r <= 20 && g <= 20 && b <= 20) return 'black'
  return 'colored'
}

export function logoWarnings(a: LogoAnalysis): LogoWarning[] {
  const out: LogoWarning[] = []
  if (a.flatBackground) out.push({ key: 'flat', text: `This logo has a ${boxWord(a.flatBackground)} box behind it.` })
  else if (!a.hasTransparency) out.push({ key: 'notFlat', text: NOT_FLAT_TEXT })
  if (a.lowRes) out.push({ key: 'lowRes', text: 'This logo is small, so it may look blurry.' })
  if (a.huge) out.push({ key: 'huge', text: 'This file is very large, so it will load slowly.' })
  return out
}
