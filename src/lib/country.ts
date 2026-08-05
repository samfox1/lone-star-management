/**
 * One canonical spelling for a tour date's country.
 *
 * Bandsintown and Ticketmaster both write into tour_dates.country, and they
 * disagree about the same place: Bandsintown sends "United States", Ticketmaster
 * sends country.name "United States Of America" plus a separate countryCode "US".
 * Left raw, one artist's dates read three different ways in the same list and no
 * filter or grouping on country can ever be right.
 *
 * CANONICAL FORM: the full English name, as a manager would type it into the Tour
 * form ("United Kingdom", not "GB"). The tour row renders `city, state ?? country`,
 * so this string is shown to fans — a two-letter code would read as a US state.
 *
 * The table covers the variants the two APIs actually emit (long names, ISO
 * alpha-2 codes, the common short forms). Anything unrecognised passes through
 * trimmed: a wrong-but-verbatim value beats dropping the country entirely.
 */
const CANONICAL: Record<string, string> = {}

function alias(canonical: string, ...variants: string[]): void {
  for (const v of [canonical, ...variants]) CANONICAL[v.toLowerCase()] = canonical
}

alias('United States', 'United States Of America', 'United States of America', 'USA', 'US', 'U.S.', 'U.S.A.')
alias('United Kingdom', 'UK', 'GB', 'Great Britain', 'England')
alias('Canada', 'CA')
alias('Ireland', 'IE')
alias('Germany', 'DE', 'Deutschland')
alias('France', 'FR')
alias('Spain', 'ES', 'España')
alias('Italy', 'IT')
alias('Netherlands', 'NL', 'The Netherlands', 'Holland')
alias('Belgium', 'BE')
alias('Austria', 'AT')
alias('Switzerland', 'CH')
alias('Sweden', 'SE')
alias('Norway', 'NO')
alias('Denmark', 'DK')
alias('Finland', 'FI')
alias('Poland', 'PL')
alias('Portugal', 'PT')
alias('Australia', 'AU')
alias('New Zealand', 'NZ')
alias('Japan', 'JP')
alias('Mexico', 'MX')
alias('Brazil', 'BR')

/** Canonical country name for an API-supplied name or ISO code; null when absent. */
export function canonicalCountry(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim()
  if (!s) return null
  return CANONICAL[s.toLowerCase()] ?? s
}
