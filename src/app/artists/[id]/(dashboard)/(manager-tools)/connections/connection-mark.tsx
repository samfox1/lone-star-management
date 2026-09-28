import { socialIcon } from '@samfox1/site-bridge/social-icons'
import { Icon } from '@/components/ui/icons'
import { SERVICE_ICONS } from '@/lib/service-icons'
import type { ConnectionDef } from '@/lib/connections'

/**
 * A connection's mark, drawn MONOCHROME so it takes the row's colour — black when the
 * connection is set, grey when it is not — like the platform logos in the song modal.
 * Every connection has its OWN brand mark (Sam, 2026-09-28: "Each connection should have an
 * icon associated with it"): socials the bridge's (sites draw them too), services the
 * dashboard's (lib/service-icons, generated from simple-icons like the bridge's). The
 * dashboard's generic link glyph is only a fallback for a connection added without one —
 * and service-icons.test.ts makes that a failing test, not a quiet gap.
 */
export function ConnectionMark({ def, size = 16, className }: { def: ConnectionDef; size?: number; className?: string }) {
  const path = def.social ? socialIcon(def.social)?.path : SERVICE_ICONS[def.key]?.path
  if (path) {
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden className={className}>
        <path d={path} />
      </svg>
    )
  }
  return <Icon name="links" size={size} className={className} />
}
