/**
 * A compact 30-day analytics figure for a content card (release listens, ticket
 * clicks, buy clicks) — a mono number + uppercase caption, matching the analytics
 * stat tiles. Hidden entirely at 0, so cards with no traffic yet stay clean rather
 * than showing a wall of zeros.
 */
export function CardStat({ value, label }: { value: number; label: string }) {
  if (!value) return null
  return (
    <div className="mt-1 flex items-baseline gap-1 font-space text-[10px] uppercase tracking-[0.08em] text-ink-faint">
      <span className="text-[12px] font-bold tabular-nums text-ink-muted">{value.toLocaleString()}</span>
      <span>
        {label} · 30d
      </span>
    </div>
  )
}
