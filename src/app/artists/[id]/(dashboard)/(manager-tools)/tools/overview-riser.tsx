'use client'

import { publishAction } from '../../actions'
import { PublishRiser } from '../_ui/publish-riser'

/**
 * THE OVERVIEW'S PUBLISH (Sam, 2026-10-05, prototypes/overview_20261002.html): the rising bar
 * every other tool uses (publish-riser.tsx), up only while something waits. It replaced the
 * standing "Publish all" button, and publishes what that did: everything (`publishAction`,
 * password-gated server-side). `message` is waitingMessage(diff); '' keeps the bar down.
 *
 * No router.refresh() after: publishAction revalidates the layout (publishGated), so its answer
 * already carries the fresh page. A refresh on top rendered it twice.
 */
export function OverviewRiser({ artistId, message }: { artistId: string; message: string }) {
  return <PublishRiser dirty={message !== ''} message={message} noun="site" onPublish={(password) => publishAction(artistId, password)} />
}
