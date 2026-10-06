import { Suspense } from 'react'
import { epkReadiness, parsePressQuotes, type EpkRequirement } from '@/lib/epk'
import { PROFILE_SEG } from '@/lib/manager-tools/profile/route'
import { getPublishedSite } from '@/lib/site'
import { createClient } from '@/lib/supabase/server'
import { requireArtist } from '../../_data'
import { LedgerRow, LedgerSection } from '../_ui/ledger'
import { RowIcon } from '../_ui/row-icon'
import { LinkItem, QuietItem, RowFace, RowMark, RowValue } from '../_ui/disclosure'
import { SitePendingBar } from '../_ui/site-pending'
import { DocumentUpload } from './document-upload'
import { PressKitForm } from './press-kit-form'

/**
 * Where each requirement is fixed, and the word its row says on hover. The contact is the
 * editor's Links › Contact list (Sam, 2026-10-05): the rule reads only a published mailto:
 * link, and Settings can set none, so it was a dead end. The editor has no panel deep link.
 */
const FIX: Record<EpkRequirement['key'], { seg: string; label: string }> = {
  bio: { seg: PROFILE_SEG, label: 'Profile' },
  photo: { seg: PROFILE_SEG, label: 'Profile' },
  contact: { seg: 'editor', label: 'Editor' },
  release: { seg: 'music', label: 'Music' },
}

/**
 * Press kit (EPK), in Brand's ledger (Batch 3, Sam 2026-10-02, prototypes/batch3_20261002.html):
 * no cards, no Save button. PDF (download and the public page, two bare glyphs) · Needs (the
 * readiness checklist as ✓ rows; a missing one links to where it is fixed) · Pitch · Quotes ·
 * Documents (the stage plot and the tech rider) · the rising Publish bar.
 *
 * Every field saves itself to the DRAFT (press-kit-form.tsx, document-upload.tsx, through the
 * same two actions as before). The pitch, the quotes and both documents ride the profile
 * snapshot (ARTIST_SNAPSHOT), so they only reach the PDF and /[slug]/epk once published: the bar
 * (_ui/site-pending.tsx, Profile's and SEO / GEO's) makes that visible and ships it, with
 * everything else that is waiting for the site (Sam OK'd, 2026-10-02).
 *
 * The checklist reads PUBLISHED data, which is the whole reason it is trustworthy. The PDF is
 * built from published content so it can never disagree with the public link, so a checklist
 * reading working rows would switch the download on while the file came out empty. A missing
 * row's hint ("…, then publish") is read to a screen reader; on screen the row links to where it
 * is fixed, and the bar says when a fix is still waiting to be published.
 */
export default async function EpkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const artist = await requireArtist(id)
  const supabase = await createClient()

  const [{ data: press }, site] = await Promise.all([
    supabase.from('artists').select('press_pitch, press_quotes, tech_rider_path, stage_plot_path').eq('id', id).single(),
    getPublishedSite(supabase, artist.slug as string),
  ])

  const { data: releaseRows } = await supabase.rpc('get_public_releases', { p_slug: artist.slug })
  const { requirements, ready } = epkReadiness({
    site,
    releaseCount: ((releaseRows as unknown[] | null) ?? []).length,
  })
  const met = requirements.filter((q) => q.met).length

  const row = press as {
    press_pitch: string | null
    press_quotes: unknown
    tech_rider_path: string | null
    stage_plot_path: string | null
  } | null

  return (
    <>
      <LedgerSection label="PDF">
        <LedgerRow title="Press kit" meta={`${met} of ${requirements.length} ready`}>
          {ready ? (
            // A plain link, not a fetch: the browser handles the download, so a slow build
            // shows normal browser progress instead of a spinner we would have to invent.
            <RowIcon icon="download" label="Download" variant="bare" href={`/artists/${id}/epk/download`} download="" />
          ) : (
            // NO link while the gate is closed: a disabled-looking anchor is still a link
            // somebody can right-click, copy and share.
            <RowIcon icon="download" label="Download" variant="bare" disabled />
          )}
          <RowIcon icon="external" label="View online" variant="bare" href={`/${artist.slug}/epk`} link="external" className="ml-[18px]" />
        </LedgerRow>
      </LedgerSection>

      <LedgerSection label="Needs">
        {/* Pulled out 12px like every A-row list, so a row's grey reaches past the text column. */}
        <div className="-mx-3">
          {requirements.map((q) =>
            q.met ? (
              <QuietItem key={q.key} itemData={{ 'data-need': q.key }}>
                <RowFace mark={<RowMark kind="check" />} name={q.label} srWord="done" />
              </QuietItem>
            ) : (
              <LinkItem key={q.key} href={`/artists/${id}/${FIX[q.key].seg}`} label={FIX[q.key].label} itemData={{ 'data-need': q.key }}>
                <RowFace
                  mark={<RowMark kind="red-ring" />}
                  name={q.label}
                  srWord={`still needed. ${q.hint}`}
                  value={<RowValue bad>missing</RowValue>}
                  open={false}
                />
              </LinkItem>
            ),
          )}
        </div>
      </LedgerSection>

      <PressKitForm artistId={id} pitch={row?.press_pitch ?? ''} quotes={parsePressQuotes(row?.press_quotes)} />

      <LedgerSection label="Documents">
        <DocumentUpload
          artistId={id}
          kind="stage_plot"
          label="Stage plot"
          hint="Where each player stands and what they need plugged in."
          present={!!row?.stage_plot_path}
        />
        <DocumentUpload artistId={id} kind="tech_rider" label="Tech rider" hint="Gear, mics and sound requirements." present={!!row?.tech_rider_path} />
      </LedgerSection>

      {/* Its own boundary, so the pending check never holds up the page above it. */}
      <Suspense fallback={null}>
        <SitePendingBar artistId={id} />
      </Suspense>
    </>
  )
}
