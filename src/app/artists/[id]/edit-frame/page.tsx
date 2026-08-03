import { notFound } from 'next/navigation'
import { ArtistTemplate } from '@/components/artist-template'
import { createClient } from '@/lib/supabase/server'
import { getWorkingSite } from '@/lib/site'
import { EditFrameBridge } from './edit-frame-bridge'

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
      <style>{`
        [data-lse-field],[data-lse-slot],[data-lse-item]{cursor:pointer}
        [data-lse-field]:hover,[data-lse-item]:hover{outline:2px solid #2563eb;outline-offset:2px;border-radius:2px}
        [data-lse-slot]:hover{outline:2px dashed rgba(37,99,235,.5);outline-offset:6px}
        /* The region the editor is highlighting (a tile click in the inspector). A solid
           ring + soft wash so it reads as "this one" even mid-scroll. */
        [data-lse-highlight]{outline:3px solid #2563eb!important;outline-offset:3px;border-radius:2px;box-shadow:0 0 0 9999px rgba(37,99,235,.06)}
      `}</style>
      <ArtistTemplate data={site} editable />
      <EditFrameBridge />
    </>
  )
}
