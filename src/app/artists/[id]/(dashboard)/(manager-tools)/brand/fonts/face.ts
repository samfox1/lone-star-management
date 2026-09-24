import { sanitizeFamily } from '@/lib/fonts'
import { weightName } from '@/lib/font-weight'
import { isGoogleFamilyName } from '@/lib/google-fonts'

/**
 * The CSS a Brand font is SET IN: the sanitized family token, never the raw one. The
 * family comes off the database and ends up in a `style` attribute (and, through
 * fontFaceCss, in a <style> tag), so it goes through the one allowlist every emitter
 * uses. One spelling, so the row, the menu and the preview can never disagree.
 *
 * A GOOGLE font (20260925120000) is set in its real family instead — Google's stylesheet
 * declares "Big Shoulders Display", and the token names no face at all. The name passes the
 * Google-name allowlist first (letters, digits, single spaces: nothing to escape); a name
 * that fails it falls back to the token.
 */
export const faceOf = (family: string, googleFamily?: string | null) =>
  isGoogleFamilyName(googleFamily) ? `'${googleFamily}', sans-serif` : `'${sanitizeFamily(family)}', sans-serif`

/**
 * Samples are matched by MEASURED capital height, not raw px (Sam, 2026-09-23: Sorg Font
 * "seems super small"). `font-size-adjust` was tried first and is not enough: it trusts the
 * font's own x-height metric, which handwriting faces often misreport, and React appends
 * "px" to a numeric value so the browser dropped it anyway. The browser measures the real
 * ink of an "H" (useSampleSize) and this picks the px that gives every face the same cap.
 */
export const SAMPLE_CAP_PX = 13
/** Clamp so a face with broken metrics can't produce a huge or unreadable sample. */
export const SAMPLE_MIN_PX = 14
export const SAMPLE_MAX_PX = 30
export function fittedFontSize(capRatio: number | null | undefined, targetCap = SAMPLE_CAP_PX, fallback = 16): number {
  if (!capRatio || !Number.isFinite(capRatio) || capRatio <= 0) return fallback
  const scale = targetCap / SAMPLE_CAP_PX
  return Math.min(SAMPLE_MAX_PX * scale, Math.max(SAMPLE_MIN_PX * scale, Math.round(targetCap / capRatio)))
}

/** Below this, a browser FAKES bold for the face (Semi Bold is bold enough). */
export const BOLD_FROM = 600

/** The nine standard weights, named by `weightName` — what the upload asks for when a
 *  file cannot say (WOFF2). Derived, so the menu and the row's line use one vocabulary. */
export const WEIGHT_CHOICES = [100, 200, 300, 400, 500, 600, 700, 800, 900].map((w) => ({
  value: String(w),
  label: weightName(w),
}))
