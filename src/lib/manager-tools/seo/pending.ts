import type { UnpublishedDiff } from '@/lib/content'
import { plural } from '../format'

const count = (d: { added: number; edited: number; deleted: number }) => d.added + d.edited + d.deleted

/** What the SEO Publish bar says is waiting, in a few words: "Site text and 1 link changed".
 *  The same parts the bar ships (layout.tsx): the profile, the site text, the site's photos,
 *  and the links a test's fix can change. '' when nothing is. */
export function pendingMessage(diff: UnpublishedDiff): string {
  const parts: string[] = []
  if (diff.profile.dirty) parts.push('profile')
  if (diff.site_content.dirty) parts.push('site text')
  if (diff.media.site?.dirty ?? diff.media.dirty) parts.push('photos')
  if (diff.link?.dirty) parts.push(plural(count(diff.link), 'link', 'links'))
  if (!parts.length) return ''
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
  return `${list.charAt(0).toUpperCase()}${list.slice(1)} changed`
}
