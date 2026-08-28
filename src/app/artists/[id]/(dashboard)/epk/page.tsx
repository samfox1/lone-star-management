import Link from 'next/link'
import { epkReadiness, parsePressQuotes } from '@/lib/epk'
import { getPublishedSite } from '@/lib/site'
import { createClient } from '@/lib/supabase/server'
import { Icon } from '@/components/ui/icons'
import { buttonClass } from '@/components/ui/ui'
import { requireArtist } from '../_data'
import { DocumentUpload } from './document-upload'
import { PressKitForm } from './press-kit-form'

/**
 * Press kit (EPK).
 *
 * Three things live here: the two press-only fields the manager types, the two documents
 * they upload, and the generated PDF.
 *
 * The checklist reads PUBLISHED data, which is the whole reason it is trustworthy. The
 * PDF is built from published content so it can never disagree with the public link, so a
 * checklist reading working rows would switch the button on while the file came out empty.
 * That also means the honest answer to "why is my bio not counted?" is usually "you have
 * not published it", and the hints say so.
 */
export default async function EpkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const artist = await requireArtist(id)
  const supabase = await createClient()

  const [{ data: press }, site] = await Promise.all([
    supabase
      .from('artists')
      .select('press_pitch, press_quotes, tech_rider_path, stage_plot_path')
      .eq('id', id)
      .single(),
    getPublishedSite(supabase, artist.slug as string),
  ])

  const { data: releaseRows } = await supabase.rpc('get_public_releases', { p_slug: artist.slug })
  const { requirements, ready } = epkReadiness({
    site,
    releaseCount: ((releaseRows as unknown[] | null) ?? []).length,
  })

  const row = press as {
    press_pitch: string | null
    press_quotes: unknown
    tech_rider_path: string | null
    stage_plot_path: string | null
  } | null

  return (
    <div className="max-w-3xl space-y-10">

      {/* The gate. It states what is missing and why, because this is the only place the
          manager finds out why the button is off. */}
      <section className="rounded-xl border border-hairline p-4">
        <h2 className="font-space text-[11px] font-bold uppercase tracking-[0.1em] text-ink-faint">
          {ready ? 'Ready to send' : 'Before you can download'}
        </h2>
        <ul className="mt-3 space-y-2">
          {requirements.map((q) => (
            <li key={q.key} className="flex items-start gap-2">
              {/* `text-accent` (the blue), not a green — this palette has no green token,
                  and an undefined Tailwind colour is silently dropped rather than failing. */}
              <span className={q.met ? 'text-accent' : 'text-ink-faint'} aria-hidden>
                <Icon name={q.met ? 'check' : 'minus'} size={15} />
              </span>
              <span className="font-space text-xs leading-relaxed">
                <span className={q.met ? 'text-ink-muted' : 'font-bold text-ink'}>{q.label}</span>
                {!q.met && <span className="text-ink-faint"> — {q.hint}</span>}
              </span>
              <span className="sr-only">{q.met ? 'done' : 'still needed'}</span>
            </li>
          ))}
        </ul>

        <div className="mt-4 flex items-center gap-3">
          {ready ? (
            // A plain link, not a fetch: the browser handles the download, so a slow build
            // shows normal browser progress instead of a spinner we would have to invent.
            <a href={`/artists/${id}/epk/download`} className={buttonClass('solid')} download>
              Download press kit
            </a>
          ) : (
            <button type="button" disabled className={buttonClass('ghost')} aria-disabled>
              Download press kit
            </button>
          )}
          <Link href={`/${artist.slug}/epk`} className={buttonClass('ghost')}>
            View online
          </Link>
        </div>
      </section>

      <PressKitForm
        artistId={id}
        pitch={row?.press_pitch ?? ''}
        quotes={parsePressQuotes(row?.press_quotes)}
      />

      <section className="space-y-4 border-t border-hairline pt-8">
        <div>
          <h2 className="font-space text-[11px] font-bold uppercase tracking-[0.1em] text-ink-faint">
            Stage plot & tech rider
          </h2>
          <p className="mt-2 font-space text-xs leading-relaxed text-ink-faint">
            PDFs, up to 10 MB. They are private — nobody can reach them by link. They only
            leave here stapled to the back of the press kit.
          </p>
        </div>
        <DocumentUpload
          artistId={id}
          kind="stage_plot"
          label="Stage plot"
          hint="Where each player stands and what they need plugged in."
          present={!!row?.stage_plot_path}
        />
        <DocumentUpload
          artistId={id}
          kind="tech_rider"
          label="Tech rider"
          hint="Gear, mics and sound requirements."
          present={!!row?.tech_rider_path}
        />
      </section>
    </div>
  )
}
