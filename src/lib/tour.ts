/**
 * Tour-date rules shared by the dashboard row and anything else that has to agree with it.
 *
 * `isPastShow` — by DATE, with the stored flag as the override (Sam, 2026-09-11: "They
 * should all say past"). A show dated before `today` is past whatever the flag says;
 * the flag catches a show with no date, or one the manager marks regardless. `today` is
 * a YYYY-MM-DD string the caller computed once, so the comparison is a plain string
 * compare and never depends on the reader's clock or timezone.
 */
export function isPastShow(show: { date: string | null; is_past: boolean }, today: string): boolean {
  if (show.is_past) return true
  return show.date !== null && show.date < today
}

/**
 * A show's start time as 24h `HH:MM`, or null when `raw` is not one (20261001140000).
 * It is the LOCAL wall-clock time at the venue, with no zone: Bandsintown's bulk upload
 * wants exactly this shape, and it rides the public snapshot to every site, so nothing
 * looser gets through. A one-digit hour is padded ("9:05" → "09:05"); seconds, am/pm,
 * other separators, surrounding spaces and non-ASCII digits are refused. The column's
 * CHECK holds the same pattern.
 */
export function parseStartTime(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const m = /^([01]?[0-9]|2[0-3]):([0-5][0-9])$/.exec(raw)
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null
}

/** Today as YYYY-MM-DD, UTC — the one place the dashboard reads the clock for shows. */
export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

/** Country name → the short code the tour list prints ("Amsterdam, NL"), so a foreign
 *  date's place column stays as narrow as "Austin, TX" (Sam, 2026-09-11). Only names we
 *  are sure of; an unknown country is left AS WRITTEN rather than guessed, and a value
 *  that already is a code is kept. Keys are lower-case, spaces collapsed. */
export const COUNTRY_CODES: Record<string, string> = {
  'united states': 'US', usa: 'US', 'united states of america': 'US',
  'united kingdom': 'UK', england: 'UK', scotland: 'UK', wales: 'UK', 'great britain': 'UK',
  netherlands: 'NL', 'the netherlands': 'NL', holland: 'NL',
  germany: 'DE', france: 'FR', spain: 'ES', italy: 'IT', portugal: 'PT', belgium: 'BE',
  switzerland: 'CH', austria: 'AT', ireland: 'IE', denmark: 'DK', sweden: 'SE', norway: 'NO',
  finland: 'FI', poland: 'PL', 'czech republic': 'CZ', czechia: 'CZ', hungary: 'HU', greece: 'GR',
  canada: 'CA', mexico: 'MX', brazil: 'BR', argentina: 'AR', chile: 'CL', colombia: 'CO',
  australia: 'AU', 'new zealand': 'NZ', japan: 'JP', 'south korea': 'KR', china: 'CN',
  india: 'IN', singapore: 'SG', indonesia: 'ID', thailand: 'TH', 'south africa': 'ZA',
  'united arab emirates': 'UAE', turkey: 'TR', israel: 'IL', iceland: 'IS', croatia: 'HR',
}

export function countryCode(country: string | null | undefined): string | null {
  const raw = (country ?? '').trim().replace(/\s+/g, ' ')
  if (!raw) return null
  const known = COUNTRY_CODES[raw.toLowerCase()]
  if (known) return known
  // Already a code (2–3 letters): print it upper-case rather than as typed.
  if (/^[a-z]{2,3}$/i.test(raw)) return raw.toUpperCase()
  return raw
}
