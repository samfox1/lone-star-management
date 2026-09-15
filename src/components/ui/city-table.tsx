'use client'

import { cx } from '@/lib/cx'
import { countryName, type Tally } from '@/lib/analytics-places'
import type { CountryFocus } from '@/lib/analytics-map'
import type { MajorCity } from '@/lib/analytics-major-cities'
import { FOCUS_RING } from '@/components/ui/map-parts'

/**
 * WHERE THEY ARE — the list beside the map. Two levels (Sam, 2026-09-14: "the broadest view is
 * country"): COUNTRIES, ranked by all their visitors, each saying how many major cities it has and
 * each a way in; and, inside a country, its MAJOR CITIES (lib/analytics-major-cities.ts), the places
 * worth touring: the city with its state under it, a bar for its share of the leader, visitors bold,
 * views quiet. Then the visitors no major city reaches as one quiet "Other places" row, and under the
 * list a note saying how far a city reaches (Sam: "add a note that the cities include +x miles
 * around"). The country's name at the top is the way back out. The map and the globe follow the same
 * `country`, owned above in PlacesSection, and draw the same cities as dots.
 *
 * Every row is listed and the list SCROLLS inside the height it is given, the map / globe box beside
 * it; the header sits above the scroll box and the note below it, so neither scrolls away. Visits the
 * door could not place are one last "Not located" row at the country level, and when no country is
 * known at all the list says so instead.
 */
export function CityTable({ countries, unlocated, majorCities, other, radiusMi, country, onSelectCountry, empty = 'No locations yet.', className }: {
  /** Every located country, most visitors first. */
  countries: Pick<CountryFocus, 'code' | 'name' | 'visitors' | 'views' | 'majorCities'>[]
  /** Visitors in no country. */
  unlocated: Tally | null
  /** Every country's major cities with an audience, most visitors first. */
  majorCities: MajorCity[]
  /** Visitors no major city reaches, by country. */
  other: Record<string, Tally>
  radiusMi: number
  country: string | null
  onSelectCountry: (code: string | null) => void
  empty?: string
  className?: string
}) {
  if (countries.length === 0) return <p className={cx('font-space text-xs text-ink-faint', className)}>{empty}</p>

  const inside = country === null ? null : majorCities.filter((m) => m.country === country)
  const max = (inside ?? countries).reduce((m, r) => Math.max(m, r.visitors), 1)
  const otherHere = country === null ? undefined : other[country]

  // The header is its OWN table above the scroll box (Sam: "keep the countries, visitors, views
  // text at the top, above the scrollable container"). Both tables share a fixed column layout and
  // reserve the same scrollbar gutter, so the columns line up.
  return (
    <div className={cx('flex min-h-0 flex-col', className)}>
      <div className="shrink-0 overflow-y-hidden [scrollbar-gutter:stable]">
        <table className="w-full table-fixed border-collapse">
          <Cols />
          <thead>
            <tr className="border-b border-hairline">
              <th scope="col" className={cx(HEAD, 'text-left')}>
                {country ? (
                  <button type="button" onClick={() => onSelectCountry(null)} className={cx('flex items-center gap-1 rounded-sm hover:text-ink', FOCUS_RING)} aria-label={`Back to countries (${countryName(country)})`}>
                    <span aria-hidden className="text-[12px] leading-none">‹</span>
                    <span>{countryName(country)}</span>
                  </button>
                ) : 'Countries'}
              </th>
              <th scope="col" className={HEAD} />
              <th scope="col" className={cx(HEAD, 'text-right')}>Visitors</th>
              <th scope="col" className={cx(HEAD, 'text-right')}>Views</th>
            </tr>
          </thead>
        </table>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]">
        <table className="w-full table-fixed border-collapse">
          <Cols />
          <tbody>
            {inside
              ? <>
                  {inside.map((m) => <Row key={m.key} name={m.name} sub={m.region} visitors={m.visitors} views={m.views} share={m.visitors / max} />)}
                  {otherHere && <Row name="Other places" sub="" visitors={otherHere.visitors} views={otherHere.views} quiet />}
                </>
              : <>
                  {countries.map((c) => (
                    <Row key={c.code} name={c.name} sub={c.majorCities ? `${c.majorCities} ${c.majorCities === 1 ? 'city' : 'cities'}` : ''} visitors={c.visitors} views={c.views} share={c.visitors / max} onClick={() => onSelectCountry(c.code)} />
                  ))}
                  {unlocated && <Row name="Not located" sub="" visitors={unlocated.visitors} views={unlocated.views} quiet />}
                </>}
          </tbody>
        </table>
      </div>
      {country && (
        <p className="shrink-0 pt-2 font-space text-[10px] uppercase tracking-[0.1em] text-ink-faint">{`Each city includes visitors within ${radiusMi} miles.`}</p>
      )}
    </div>
  )
}

/** One column layout for both tables: name, bar, visitors, views. */
function Cols() {
  return (
    <colgroup>
      <col />
      <col style={{ width: '28%' }} />
      <col style={{ width: 64 }} />
      <col style={{ width: 64 }} />
    </colgroup>
  )
}

const HEAD = 'pb-2 font-space text-[10px] font-bold uppercase tracking-[0.12em] text-ink-faint'
const NUM = 'py-1.5 pl-4 text-right font-space text-[11px] tabular-nums'

function Row({ name, sub, visitors, views, share, quiet, onClick }: { name: string; sub: string; visitors: number; views: number; share?: number; quiet?: boolean; onClick?: () => void }) {
  const label = (
    <>
      <span className={cx('block truncate text-sm', quiet ? 'text-ink-faint' : 'text-ink')}>{name}</span>
      {sub && <span className="block truncate font-space text-[10px] uppercase tracking-[0.1em] text-ink-faint">{sub}</span>}
    </>
  )
  return (
    <tr className={cx('border-b border-hairline', onClick && 'cursor-pointer hover:bg-surface')} onClick={onClick}>
      <td className="py-1.5 pr-4">
        {onClick
          ? <button type="button" onClick={(e) => { e.stopPropagation(); onClick() }} className={cx('block w-full rounded-sm text-left', FOCUS_RING)}>{label}</button>
          : label}
      </td>
      <td className="py-1.5">
        {share !== undefined && (
          <span className="block h-[7px] overflow-hidden rounded-full bg-track">
            <span data-bar aria-hidden className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(2, share * 100)}%` }} />
          </span>
        )}
      </td>
      <td className={cx(NUM, quiet ? 'text-ink-faint' : 'font-bold text-ink')}>{visitors.toLocaleString('en-US')}</td>
      <td className={cx(NUM, quiet ? 'text-ink-faint' : 'text-ink-muted')}>{views.toLocaleString('en-US')}</td>
    </tr>
  )
}
