/**
 * Tiny inline SVG charts for the manager surface. They take an optional numeric
 * series; with no series (the common case until real time-series analytics land)
 * they render a flat baseline — a clean "no movement yet" placeholder that keeps
 * the prototype's visual shape. Stroke is `currentColor`, so colour them with a
 * text-* utility on the element.
 */
type Series = number[] | undefined

function linePoints(values: Series, w: number, h: number, pad: number): string {
  if (!values || values.length < 2) {
    const y = (h * 0.55).toFixed(1) // flat baseline, slightly below centre
    return `0,${y} ${w},${y}`
  }
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  return values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w
      const y = pad + (1 - (v - min) / span) * (h - pad * 2)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

/** Small trend line (roster rows, movers). Colour via a text-* class on it. */
export function Sparkline({
  values,
  width = 72,
  height = 24,
  className,
}: {
  values?: number[]
  width?: number
  height?: number
  className?: string
}) {
  const pts = linePoints(values, width, height, 2)
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      // Intrinsic width/height so a `w-full` sparkline can't flash at the SVG default size
      // (~300×150) before the viewBox aspect ratio settles. CSS classes (w-full, h-12 …)
      // still override these, so callers that size via className are unaffected.
      width={width}
      height={height}
      preserveAspectRatio="none"
      className={className}
      aria-hidden="true"
    >
      <polyline
        points={pts}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** Filled area chart (analytics band). Line is `currentColor`; fill is a light track. */
export function AreaChart({
  values,
  height = 160,
  className,
}: {
  values?: number[]
  height?: number
  className?: string
}) {
  const w = 320
  const h = height
  const pts = linePoints(values, w, h, 6)
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className={className}
      style={{ width: '100%', height }}
      aria-hidden="true"
    >
      <polygon points={`${pts} ${w},${h} 0,${h}`} style={{ fill: 'var(--color-track)' }} />
      <polyline
        points={pts}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
