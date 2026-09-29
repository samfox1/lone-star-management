'use client'

import { socialIcon } from '@samfox1/site-bridge/social-icons'
import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'

/* Its own file on purpose: tests/unit/site/no-instruction-copy.test.ts finds `<p>` elements
   by a simple pattern that also matches an SVG path element, and in a file that also closes a
   paragraph it would read the code between them as copy. */

/** A platform's own mark (the bridge's, the ones the sites draw), monochrome. */
export function PlatformMark({ slug, size = 15, className }: { slug: string; size?: number; className?: string }) {
  const path = socialIcon(slug)?.path
  if (!path) return <Icon name="links" size={size} className={className} />
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true" className={cx('flex-none', className)}>
      <path d={path} />
    </svg>
  )
}
