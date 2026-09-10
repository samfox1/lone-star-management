/**
 * What an assets page shows for the ~300ms between clicking its tab and its data arriving
 * (2026-09-10). Rendered by each page's loading.tsx, beside the rail the layout keeps in
 * place, so a tab switch answers instantly instead of freezing the old page.
 *
 * NO WORDS, on purpose (no-instruction-copy, 2026-08-12): a toolbar-shaped bar and a grid
 * of tile-shaped blocks, in the sizes the real grid uses. It says "the grid is coming"
 * by looking like the grid, not by saying so.
 */
export function AssetsSkeleton({ tiles = 8 }: { tiles?: number }) {
  return (
    <div aria-hidden className="animate-pulse space-y-6 pb-24">
      <div className="flex items-center justify-between">
        <div className="h-7 w-40 rounded-md bg-surface" />
        <div className="h-8 w-56 rounded-lg bg-surface" />
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,192px)] gap-x-5 gap-y-8">
        {Array.from({ length: tiles }, (_, i) => (
          <div key={i}>
            <div className="aspect-square w-full rounded-2xl bg-surface" />
            <div className="mt-2.5 h-4 w-3/4 rounded bg-surface" />
          </div>
        ))}
      </div>
    </div>
  )
}
