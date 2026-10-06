'use client'

import { toast } from './toast'

/**
 * SHARE A PUBLIC PAGE (a release, a song, a video): the device's own share sheet where there is
 * one; otherwise, or when the sheet is cancelled, the link is copied and a toast says so. The
 * release, song and video cards each wrote this out until 2026-10-05.
 */
export async function shareLink(title: string, url: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.share) {
    try {
      await navigator.share({ title, url })
      return
    } catch {
      // cancelled or unsupported — fall through to copy
    }
  }
  try {
    await navigator.clipboard.writeText(url)
    toast('Link copied')
  } catch {
    toast("Couldn't copy the link.", 'error')
  }
}
