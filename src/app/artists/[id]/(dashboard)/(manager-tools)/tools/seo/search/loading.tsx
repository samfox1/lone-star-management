import { SourceGlyph } from '@/components/ui/source-glyphs'
import { SEARCH_PERIODS, type SearchPeriodKey } from '@/lib/manager-tools/seo/search-stats'

/**
 * The Search tab while Google and Bing are asked. The page waits for both engines (up to the
 * 12 s deadline when one refuses or hangs, since those answers are never cached), and before this
 * a click on the tab left the old tab on screen with no sign anything was happening.
 *
 * Light on purpose: the title row's switches, dimmed as the tab dims a pending period switch, and
 * empty room the height of the two charts, so nothing jumps when they land. A `?p=` switch keeps
 * this segment's boundary (Next keys it without the search params), so the tab's own
 * useTransition dimming runs there instead of this.
 */
export default function Loading() {
  return (
    <div aria-busy className="opacity-50">
      <div aria-hidden className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <span className="h-[18px] w-72 rounded bg-hairline-soft" />
        <div className="flex items-center gap-x-6">
          <div className="flex items-center gap-3 text-ink-faint">
            <span className="flex gap-1"><SourceGlyph source="google" size={14} /><SourceGlyph source="bing" size={14} /></span>
            <SourceGlyph source="google" size={17} />
            <SourceGlyph source="bing" size={17} />
          </div>
          <div className="flex rounded-lg border border-hairline p-0.5 font-space text-xs text-ink-muted">
            {(Object.keys(SEARCH_PERIODS) as SearchPeriodKey[]).map((p) => (
              <span key={p} className="px-2.5 py-1">{p}</span>
            ))}
          </div>
        </div>
      </div>
      {/* Your spot (380 px and its day axis), then seen and clicked (340 px). */}
      <div className="mt-8 h-[430px]" />
      <div className="mt-14 h-[420px]" />
    </div>
  )
}
