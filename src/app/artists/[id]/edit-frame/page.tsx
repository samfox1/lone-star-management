import { notFound } from 'next/navigation'
import { ArtistTemplate } from '@/components/artist-template'
import { createClient } from '@/lib/supabase/server'
import { getWorkingSite } from '@/lib/site'
import { EditFrameBridge } from './edit-frame-bridge'
import { manifestFor } from '@/lib/site-editor/manifest'
import {
  FIELD_ATTR,
  HIGHLIGHT_CSS,
  ITEM_ATTR,
  LINK_ATTR,
  MARKED,
  SLOT_ATTR,
  STYLE_ATTR,
} from '@/lib/site-editor/markers'

/**
 * EDIT-MODE FRAME (SITE_EDITOR_PLAN.md phase 1). The artist's real site rendered
 * against WORKING (draft) rows with `editable` on — so it emits the `data-lse-*`
 * markers — plus the frame bridge. The visual editor (phase 2) iframes this route
 * and drives it over postMessage.
 *
 * Manager-only + RLS-scoped exactly like /preview: under /artists (proxy-guarded),
 * and getWorkingSite returns null for a tenant the caller can't access → 404. The
 * markers + bridge NEVER load on the public site (/[slug] renders published data
 * via ArtistTemplate with editable off).
 */
export default async function EditFramePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const site = await getWorkingSite(supabase, id)
  if (!site) notFound()

  return (
    <>
      {/* Edit-mode affordance: outline the editable regions on hover so the frame
          is visibly interactive before the Phase 2 editor draws its own overlay.
          Only on this route — the public site never sees it. */}
      {/* Built FROM the marker constants (2026-08-07 review: the hand-written selector
          list had already drifted — style and link regions got no cursor or hover
          affordance, and a renamed attribute would silently stop matching). MARKED is
          every clickable-to-select attribute, straight from the package. */}
      <style>{`
        ${MARKED}{cursor:pointer}
        [${FIELD_ATTR}]:hover,[${ITEM_ATTR}]:hover,[${STYLE_ATTR}]:hover,[${LINK_ATTR}]:hover{outline:2px solid #2563eb;outline-offset:2px;border-radius:2px}
        [${SLOT_ATTR}]:hover{outline:2px dashed rgba(37,99,235,.5);outline-offset:6px}
        /* The region the editor is highlighting (a tile click in the inspector). From the
           package, so this shell and every connected site ring identically — the copy
           that used to sit here was mirrored by hand into skeen. */
        ${HIGHLIGHT_CSS}
      `}</style>
      <ArtistTemplate data={site} editable />
      <EditFrameBridge editList={manifestFor(site.artist.template)} />
    </>
  )
}
