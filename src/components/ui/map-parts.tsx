'use client'

import { memo, type CSSProperties, type ReactNode } from 'react'
import { Icon } from '@/components/ui/icons'
import { cx } from '@/lib/cx'
import { DOT_R } from '@/lib/map-constants'
import type { Point, View } from '@/lib/map-view'
import type { CityDot, Hover } from '@/components/ui/use-map-pointer'

/**
 * The pieces the flat map and the globe share, so the two views look, read and zoom the same: the
 * round buttons, the zoom pair with a slot for the view switch, each country's land, the major-city
 * dots and the marker on the one under the pointer, the readout, and the heat filter.
 */

export const FOCUS_RING = 'outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1'

export function MapButton({ label, onClick, disabled, children }: { label: string; onClick?: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cx('flex h-7 w-7 items-center justify-center rounded-full bg-paper text-ink shadow-[0_2px_8px_rgba(17,17,17,0.12)] transition-colors hover:bg-surface-hover disabled:text-ink-faint disabled:hover:bg-paper', FOCUS_RING)}
    >
      {children}
    </button>
  )
}

/** Plus, minus, and whatever the page adds beside them (the map / globe switch), bottom left. No handlers: shown, but off (the geography is still loading). */
export function ZoomControls({ onIn, onOut, extra }: { onIn?: () => void; onOut?: () => void; extra?: ReactNode }) {
  return (
    <div className="absolute bottom-2 left-2 flex items-center gap-1">
      <MapButton label="Zoom in" onClick={onIn} disabled={!onIn}><Icon name="plus" size={14} /></MapButton>
      <MapButton label="Zoom out" onClick={onOut} disabled={!onOut}><Icon name="minus" size={14} /></MapButton>
      {extra}
    </div>
  )
}

/**
 * Each country's land as its own path, found by `data-country` when the pointer is over it or clicks
 * it. Memoised: the pointer moving re-renders the readout, not two hundred countries. Keyed by code AND
 * position, because an atlas can carry one code twice (the 1:50m has AU twice).
 */
export const LandLayer = memo(function LandLayer({ lands, country, selectable, rim }: { lands: { code: string; d: string }[]; country: string | null; selectable: ReadonlySet<string>; rim: number }) {
  return (
    <g data-lands>
      {lands.map((l, i) => (
        <path
          key={`${l.code}|${i}`}
          data-land
          data-country={l.code}
          data-selected={l.code !== '' && l.code === country ? 'true' : undefined}
          d={l.d}
          fill="currentColor"
          stroke="var(--color-paper)"
          strokeWidth={rim}
          strokeLinejoin="round"
          className={cx('text-track', selectable.has(l.code) && 'cursor-pointer hover:text-hairline', l.code !== '' && l.code === country && 'text-hairline')}
        />
      ))}
    </g>
  )
})

/** One small dot per major city, at `k` zoom so it keeps its size on screen. */
export function CityDots({ dots, k = 1 }: { dots: { key: string; x: number; y: number }[]; k?: number }) {
  return (
    <>
      {dots.map((m) => (
        <circle key={m.key} data-city={m.key} cx={m.x} cy={m.y} r={DOT_R / k} fill="var(--color-ink)" stroke="var(--color-paper)" strokeWidth={0.75 / k} style={{ pointerEvents: 'none' }} />
      ))}
    </>
  )
}

export function HoverMarker({ at, k = 1 }: { at: Point; k?: number }) {
  return <circle data-marker cx={at.x} cy={at.y} r={4 / k} fill="var(--color-accent)" stroke="var(--color-paper)" strokeWidth={1.5 / k} style={{ pointerEvents: 'none' }} />
}

/** The readout for what the pointer is over, placed above it within `frame` (what the svg shows). */
export function HoverReadout({ hover, frame }: { hover: Hover<CityDot> | null; frame: View }) {
  if (!hover) return null
  const r = hover.kind === 'city'
    ? { name: hover.dot.name, sub: hover.dot.region, visitors: hover.dot.visitors, views: hover.dot.views, at: { x: hover.dot.x, y: hover.dot.y } }
    : { name: hover.focus.name, sub: undefined, visitors: hover.focus.visitors, views: hover.focus.views, at: hover.at }
  return (
    <MapReadout
      name={r.name}
      sub={r.sub}
      visitors={r.visitors}
      views={r.views}
      style={{
        left: `${(((r.at.x - frame.x) / frame.w) * 100).toFixed(2)}%`,
        top: `calc(${(((r.at.y - frame.y) / frame.h) * 100).toFixed(2)}% - 12px)`,
      }}
    />
  )
}

/** What the pointer is over — a country, or a major city with its state — and its numbers. */
export function MapReadout({ name, sub, visitors, views, style }: { name: string; sub?: string; visitors: number; views: number; style: CSSProperties }) {
  return (
    <div
      aria-hidden
      data-readout
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg bg-paper px-2.5 py-1.5 font-space text-[11px] font-bold tabular-nums text-ink shadow-[0_8px_24px_rgba(17,17,17,0.12)]"
      style={style}
    >
      <span className="block">
        {name}
        {sub && <span className="ml-1.5 font-normal uppercase tracking-[0.1em] text-ink-faint">{sub}</span>}
      </span>
      <span className="block">
        {visitors.toLocaleString('en-US')}
        <span className="ml-1 font-normal uppercase tracking-[0.1em] text-ink-faint">visitors</span>
        <span className="ml-2">{views.toLocaleString('en-US')}</span>
        <span className="ml-1 font-normal uppercase tracking-[0.1em] text-ink-faint">views</span>
      </span>
    </div>
  )
}

/** The heat ramp, sampled at 0, ⅓, ⅔, 1 of intensity: nothing → faint accent → accent → red.
 *  accent #2563eb = (37, 99, 235); accent-red #e5484d = (229, 72, 77). */
const RAMP = {
  r: '0.145 0.145 0.145 0.898',
  g: '0.388 0.388 0.388 0.282',
  b: '0.922 0.922 0.922 0.302',
  a: '0 0.3 0.62 0.85',
}

/**
 * The glow each city is drawn with (`${id}-glow`) and the filter that turns the glows into heat
 * (`id`): blur them together, take their combined opacity as intensity, paint it through the ramp.
 * userSpaceOnUse over `region`, so nothing is clipped at a glow's own box.
 */
export function HeatDefs({ id, blur, region }: { id: string; blur: number; region: { x: number; y: number; width: number; height: number } }) {
  return (
    <>
      <radialGradient id={`${id}-glow`}>
        <stop offset="0" stopColor="#000" stopOpacity="1" />
        <stop offset="1" stopColor="#000" stopOpacity="0" />
      </radialGradient>
      <filter id={id} filterUnits="userSpaceOnUse" {...region} colorInterpolationFilters="sRGB">
        <feGaussianBlur stdDeviation={blur} />
        <feColorMatrix type="matrix" values="0 0 0 1 0  0 0 0 1 0  0 0 0 1 0  0 0 0 1 0" />
        <feComponentTransfer>
          <feFuncR type="table" tableValues={RAMP.r} />
          <feFuncG type="table" tableValues={RAMP.g} />
          <feFuncB type="table" tableValues={RAMP.b} />
          <feFuncA type="table" tableValues={RAMP.a} />
        </feComponentTransfer>
      </filter>
    </>
  )
}
