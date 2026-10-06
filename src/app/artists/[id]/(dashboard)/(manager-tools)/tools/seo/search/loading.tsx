import { SourceGlyph } from '@/components/ui/source-glyphs'
import { ENGINE_NAME, ENGINE_VIEWS, PERIOD_WORDS } from '@/lib/manager-tools/seo/search-model'
import { SEARCH_PERIODS, type SearchPeriodKey } from '@/lib/manager-tools/seo/search-stats'

/**
 * The Search tab while Google and Bing are asked. The page waits for both engines (up to the
 * 12 s deadline when one refuses or hangs, since those answers are never cached), and before this
 * a click on the tab left the old tab on screen with no sign anything was happening.
 *
 * Light on purpose: the switches row, dimmed as the tab dims a pending period switch, and empty
 * room the height of the numbers and the chart, so nothing jumps when they land. A `?p=` switch
 * keeps this segment's boundary (Next keys it without the search params), so the tab's own
 * useTransition dimming runs there instead of this.
 */
export default function Loading() {
  return (
    <div aria-busy className="opacity-50">
      <div aria-hidden className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="flex flex-wrap items-center gap-x-[18px] gap-y-1">
          {ENGINE_VIEWS.map((e) => (
            <span key={e} className={SWITCH}>
              {e === 'both' ? null : <SourceGlyph source={e} size={13} />}
              {e === 'both' ? 'Both' : ENGINE_NAME[e]}
            </span>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-[18px] gap-y-1">
          {(Object.keys(SEARCH_PERIODS) as SearchPeriodKey[]).map((p) => (
            <span key={p} className={SWITCH}>
              {PERIOD_WORDS[p]}
            </span>
          ))}
        </div>
      </div>
      {/* The four numbers, then the chart (150 px and its day axis). */}
      <div className="mt-7 h-[86px]" />
      <div className="mt-9 h-[176px]" />
    </div>
  )
}

/** search-tab.tsx's SWITCH, without the hover: nothing here is clickable yet. */
const SWITCH = 'inline-flex items-center gap-[7px] whitespace-nowrap py-1.5 font-space text-[12px] tracking-[0.02em] text-ink-muted'
