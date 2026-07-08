import { Icon, type IconName } from '@/components/ui/icons'

/**
 * The empty-state card shared by the content grids/lists (releases, videos, merch,
 * tour). A large faint section icon (a placeholder for a future hand-drawn graphic)
 * over a bold line and an optional mono hint pointing at the toolbar's + Add / import.
 * Matches the site's bordered-card + mono-caption look.
 */
export function EmptyState({ icon, title, hint }: { icon: IconName; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-hairline px-6 py-16 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-surface text-ink-faint">
        <Icon name={icon} size={28} />
      </span>
      <div className="space-y-1">
        <div className="text-sm font-semibold text-ink">{title}</div>
        {hint && <div className="mx-auto max-w-xs font-space text-xs text-ink-muted">{hint}</div>}
      </div>
    </div>
  )
}
