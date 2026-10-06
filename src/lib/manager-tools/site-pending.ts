import type { UnpublishedDiff } from '@/lib/content'
import { listWords, plural } from './format'

const count = (d: { added: number; edited: number; deleted: number }) => d.added + d.edited + d.deleted

/** What the site Publish bar (SEO / GEO, Profile, Connections, EPK) says is waiting, in a few
 *  words: "Site text and 1 link changed". The same parts the bar ships (_ui/site-riser.tsx): the
 *  profile, the site text, the site's photos, and the links a test's fix or a connection's edit
 *  can change. '' when nothing is. */
export function pendingMessage(diff: UnpublishedDiff): string {
  const parts: string[] = []
  if (diff.profile.dirty) parts.push('profile')
  if (diff.site_content.dirty) parts.push('site text')
  if (diff.media.site?.dirty ?? diff.media.dirty) parts.push('photos')
  if (diff.link?.dirty) parts.push(plural(count(diff.link), 'link', 'links'))
  if (!parts.length) return ''
  const list = listWords(parts)
  return `${list.charAt(0).toUpperCase()}${list.slice(1)} changed`
}
