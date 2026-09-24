import { socialIcon } from '@samfox1/site-bridge/social-icons'
import { Icon, type IconName } from '@/components/ui/icons'
import type { ConnectionDef } from '@/lib/connections'

/**
 * A connection's mark, drawn MONOCHROME so it takes the row's colour — black when the
 * connection is set, grey when it is not — like the platform logos in the song modal.
 * Socials use the bridge's own brand paths; a service without one uses the dashboard's
 * icon for what it feeds.
 */
const SERVICE_ICON: Record<string, IconName> = {
  bandsintown: 'tour',
  ticketmaster: 'tour',
  drive: 'folder',
  shopify: 'merch',
}

export function ConnectionMark({ def, size = 16, className }: { def: ConnectionDef; size?: number; className?: string }) {
  const icon = def.social ? socialIcon(def.social) : null
  if (icon) {
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden className={className}>
        <path d={icon.path} />
      </svg>
    )
  }
  return <Icon name={SERVICE_ICON[def.key] ?? 'links'} size={size} className={className} />
}
