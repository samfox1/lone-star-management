'use client'

import { useEffect } from 'react'
import { mountFrameBridge } from '@/lib/site-editor/bridge-client'

/**
 * Mounts the frame side of the editor bridge inside the edit-mode site frame
 * (SITE_EDITOR_PLAN.md phase 1). Reports region clicks to the editor and applies
 * editor messages back. Same-origin for now — the editor and the frame are both
 * served by this app; phase 2 passes the editor's origin explicitly. Renders
 * nothing.
 */
export function EditFrameBridge() {
  useEffect(() => mountFrameBridge({ editorOrigin: window.location.origin }), [])
  return null
}
