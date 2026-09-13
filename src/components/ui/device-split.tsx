import { cx } from '@/lib/cx'
import type { DeviceSplit as Split, DeviceSummary } from '@/lib/analytics'
import { BrowserGlyph, DEVICE_LABEL, DeviceGlyph, browserLabel } from '@/components/ui/device-glyphs'

/**
 * What visits were read on, as two groups side by side: MOBILE (phones and
 * tablets) and WEB (desktop browsers). Sam asked for the split on 2026-09-13.
 *
 * Every bar in both groups is drawn against the SAME maximum, so a web bar and a
 * mobile bar are directly comparable. Rescaling each group to its own leader
 * would make the busiest desktop browser look as big as Instagram's in-app
 * browser, which it is not.
 *
 * The device word is carried by the group heading and the mark, so a row reads
 * as just the browser: "Instagram", "Safari". The in-app browsers use the
 * platform's own mark for the same reason the source rings do.
 */
export function DeviceSplit({ split, empty = 'No visits yet.', className }: { split: Split; empty?: string; className?: string }) {
  const total = split.mobileVisitors + split.webVisitors + split.otherVisitors
  if (total === 0) return <p className={cx('font-space text-xs text-ink-faint', className)}>{empty}</p>
  const pct = (n: number) => `${Math.round((n / total) * 100)}%`

  return (
    <div className={className}>
      <div className="grid gap-8 md:grid-cols-2">
        <Group title="Mobile" visitors={split.mobileVisitors} share={pct(split.mobileVisitors)} rows={split.mobile} max={split.max} />
        <Group title="Web" visitors={split.webVisitors} share={pct(split.webVisitors)} rows={split.web} max={split.max} />
      </div>
      {split.otherVisitors > 0 && (
        <p className="mt-3 font-space text-[10px] uppercase tracking-[0.1em] text-ink-faint">
          {split.otherVisitors.toLocaleString('en-US')} visitors on something the door could not classify
        </p>
      )}
    </div>
  )
}

function Group({ title, visitors, share, rows, max }: { title: string; visitors: number; share: string; rows: DeviceSummary[]; max: number }) {
  return (
    <section aria-label={title}>
      <div className="flex items-baseline justify-between gap-3 border-b border-ink pb-2">
        <span className="font-space text-[10px] font-bold uppercase tracking-[0.12em] text-ink-faint">{title}</span>
        <span className="font-space text-[10px] uppercase tracking-[0.1em] text-ink-faint">
          {visitors.toLocaleString('en-US')} · {share}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="mt-3 font-space text-xs text-ink-faint">None in this window.</p>
      ) : (
        <ol className="mt-1">
          {rows.map((d) => (
            <li
              key={`${d.device}|${d.browser}`}
              className="grid grid-cols-[auto_auto_1fr_auto] items-center gap-x-3 border-b border-hairline py-2.5"
            >
              <span className="flex items-center gap-2 text-ink" title={DEVICE_LABEL[d.device] ?? d.device}>
                <DeviceGlyph device={d.device} />
                <BrowserGlyph browser={d.browser} className="text-ink-muted" />
              </span>
              <span className="text-sm text-ink">
                {browserLabel(d.browser)}
                {d.device === 'tablet' && (
                  <span className="ml-2 font-space text-[10px] uppercase tracking-[0.1em] text-ink-faint">tablet</span>
                )}
              </span>
              <span className="h-[7px] overflow-hidden rounded-full bg-track">
                <span
                  data-bar
                  aria-hidden
                  className="block h-full rounded-full bg-accent"
                  style={{ width: `${Math.max(2, (d.visitors / max) * 100)}%` }}
                />
              </span>
              <span className="font-space text-[11px] font-bold tabular-nums text-ink">
                {d.visitors.toLocaleString('en-US')}
                <span className="sr-only"> visitors</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
