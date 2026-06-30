import Link from 'next/link'
import { Icon } from '@/components/ui/icons'
import { Avatar, Button, Field, Input, buttonClass, initials } from '@/components/ui/ui'
import { requireArtist } from '../(dashboard)/_data'
import { updateArtistAction } from '../(dashboard)/actions'

export const metadata = { title: 'Edit artist — Lone Star Management' }

/**
 * Focused "edit info" screen (the artist hero's pencil lands here). Standalone —
 * outside the (dashboard) group, so no tabs/hero — like the prototype's edit
 * view. requireArtist is the non-owner → 404 gate.
 */
export default async function EditArtistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const artist = await requireArtist(id)

  return (
    <div className="font-ui text-ink min-h-screen bg-paper">
      <div className="mx-auto max-w-xl px-6 py-10">
        <Link
          href={`/artists/${id}`}
          className="inline-flex items-center gap-1.5 font-space text-xs text-ink-muted transition-colors hover:text-ink"
        >
          <Icon name="chevronLeft" size={16} /> Back to {artist.name}
        </Link>

        <div className="mt-6 flex items-center gap-4">
          <Avatar initials={initials(artist.name)} size={56} />
          <h1 className="text-[22px] font-bold tracking-[-0.01em]">Edit info</h1>
        </div>

        <form action={updateArtistAction.bind(null, id)} className="mt-8 space-y-5">
          <Field label="Artist name">
            <Input name="name" defaultValue={artist.name} maxLength={200} required autoFocus />
          </Field>

          <Field label="Handle">
            <Input
              defaultValue={`/${artist.slug}`}
              disabled
              className="cursor-not-allowed opacity-60"
            />
          </Field>
          <p className="-mt-3 font-space text-[11px] leading-relaxed text-ink-faint">
            The handle sets the public URL (lonestar.fm/{artist.slug}) and every release smart-link,
            so it isn&apos;t editable here.
          </p>

          <div className="flex gap-2.5 pt-1">
            <Button type="submit">Save changes</Button>
            <Link href={`/artists/${id}`} className={buttonClass('ghost')}>
              Cancel
            </Link>
          </div>
        </form>

        <div className="mt-8 rounded-xl border border-dashed border-hairline p-4 font-space text-xs leading-relaxed text-ink-muted">
          Bio, profile photo, template, and site text live on the artist&apos;s{' '}
          <b className="font-bold text-ink">Site</b> tab.
        </div>
      </div>
    </div>
  )
}
