import { cx } from '@/lib/cx'
import type { Metric } from '@/lib/analytics'

/**
 * The overview: every metric as a number AND its own 30-day shape.
 *
 * The row of six identical tiles this replaces was dashboard furniture — it said
 * how big each number was and nothing about which way it was moving, which is the
 * question actually being asked. A pill carries both, and the pills are sized by
 * how much they matter rather than laid out on an even grid: views large, visitors
 * beside it, the four intent metrics small, bots quietest of all.
 *
 * Bots are shown, not hidden. They are the number that says how much of a spike
 * was real, and a reader who cannot see it has no way to tell.
 *
 * Every sparkline is drawn against ZERO and against its OWN maximum. Zero because
 * a series normalised to its minimum turns a flat week into a mountain range; its
 * own maximum because these are different units — plays and views share no scale,
 * and forcing them onto one would make every small metric a flat line.
 */

const PLOT_W = 120
const PLOT_H = 28

/** One series, zero-based, as a filled area under a line. */
function Sparkline({ series, className }: { series: number[]; className?: string }) {
  const max = Math.max(1, ...series)
  const n = series.length
  const x = (i: number) => (n < 2 ? PLOT_W / 2 : (i / (n - 1)) * PLOT_W)
  const y = (v: number) => PLOT_H - (v / max) * PLOT_H
  const points = series.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')

  return (
    <svg
      viewBox={`0 0 ${PLOT_W} ${PLOT_H}`}
      preserveAspectRatio="none"
      className={cx('block', className)}
      aria-hidden="true"
    >
      {n > 0 && (
        <>
          <polygon points={`${points} ${PLOT_W},${PLOT_H} 0,${PLOT_H}`} fill="currentColor" opacity={0.16} />
          <polyline
            points={points}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </>
      )}
    </svg>
  )
}

const fmt = (n: number) => n.toLocaleString('en-US')

/** The accessible twin. Every number is reachable without reading a chart. */
function MetricTable({ metrics }: { metrics: Metric[] }) {
  return (
    <table className="sr-only">
      <caption>Totals for the window</caption>
      <thead>
        <tr><th>Metric</th><th>Total</th></tr>
      </thead>
      <tbody>
        {metrics.map((m) => (
          <tr key={m.key}><td>{m.label}</td><td>{m.total}</td></tr>
        ))}
      </tbody>
    </table>
  )
}

export function MetricPills({ metrics, className }: { metrics: Metric[]; className?: string }) {
  // Looked up by key rather than by position: the registry decides the order it
  // ships in, and a reordered registry must not silently reshuffle the layout.
  const by = Object.fromEntries(metrics.map((m) => [m.key, m])) as Record<string, Metric | undefined>
  const views = by.views
  const visitors = by.visitors
  const bots = by.bots
  const intent = metrics.filter((m) => !['views', 'visitors', 'bots'].includes(m.key))

  return (
    <div className={className}>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {/* Views: the headline, and the only one given room for a full-width shape. */}
        {views && (
          <div className="rounded-xl bg-surface p-4 sm:col-span-2">
            <div className="font-space text-[10px] font-bold uppercase tracking-[0.12em] text-ink-faint">
              {views.label}
            </div>
            <div className="mt-2 font-space text-[44px] font-bold leading-none tracking-[-0.015em] tabular-nums text-ink">
              {fmt(views.total)}
            </div>
            <Sparkline series={views.series} className="mt-3 h-10 w-full text-accent" />
          </div>
        )}

        {visitors && (
          <div className="rounded-xl bg-surface p-4">
            <div className="font-space text-[10px] font-bold uppercase tracking-[0.12em] text-ink-faint">
              {visitors.label}
            </div>
            <div className="mt-2 font-space text-[25px] font-bold leading-none tracking-[-0.02em] tabular-nums text-ink">
              {fmt(visitors.total)}
            </div>
            <Sparkline series={visitors.series} className="mt-3 h-8 w-full text-ink-faint" />
          </div>
        )}
      </div>

      {/* What people DID. Smaller, because each is a fraction of the number above. */}
      <div className="mt-2 grid grid-cols-2 gap-2 lg:grid-cols-4">
        {intent.map((m) => (
          <div key={m.key} className="flex items-center gap-3 rounded-xl bg-surface px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="font-space text-[10px] font-bold uppercase tracking-[0.12em] text-ink-faint">
                {m.label}
              </div>
              <div className="mt-1.5 font-space text-[18px] font-bold leading-none tabular-nums text-ink">
                {fmt(m.total)}
              </div>
            </div>
            <Sparkline series={m.series} className="h-6 w-14 shrink-0 text-ink-faint" />
          </div>
        ))}
      </div>

      {/* Bots: quietest thing on the page, but never absent. */}
      {bots && (
        <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-hairline pt-2">
          <span className="font-space text-[10px] uppercase tracking-[0.1em] text-ink-faint">{bots.label}</span>
          <span className="font-space text-[11px] font-bold tabular-nums text-ink-muted">{fmt(bots.total)}</span>
        </div>
      )}

      <MetricTable metrics={metrics} />
    </div>
  )
}
