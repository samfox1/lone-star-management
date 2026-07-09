'use client'

import { Icon } from '@/components/ui/icons'
import { RELEASE_TYPES, RELEASE_TYPE_LABEL, toReleaseType } from '@/lib/releases'
import { CreateModal } from '../create-modal'
import { addReleaseAction } from '../actions'

function ReleasePreview({ cover, title, type }: { cover?: string; title?: string; type?: string }) {
  return (
    <div className="w-32">
      <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-2xl border border-hairline bg-surface text-ink-faint">
        <span className="absolute bottom-2 left-2 rounded bg-black/70 px-1.5 py-0.5 font-space text-[9px] font-bold uppercase tracking-[0.08em] text-white">
          {RELEASE_TYPE_LABEL[toReleaseType(type)]}
        </span>
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover} alt="" className="h-full w-full object-cover" />
        ) : (
          <Icon name="releases" size={26} />
        )}
      </div>
      <div className="mt-2 truncate text-sm font-semibold">{title || 'New release'}</div>
    </div>
  )
}

/**
 * Manual release creation — a demo EP, a self-release, anything not pulled from a
 * platform. A new manual release has no DSP links, so by derivation it starts in
 * the UNRELEASED half (dashboard-only); adding a streaming link in its card later
 * promotes it to Released. Backed by the existing addReleaseAction (slug suffixing).
 */
export function ReleaseAddButton({ artistId }: { artistId: string }) {
  return (
    <CreateModal
      kind="Release"
      title="Add release"
      fields={[
        { name: 'title', placeholder: 'Release title', required: true },
        {
          name: 'release_type',
          placeholder: 'Type',
          row: 1,
          width: 'sm',
          options: RELEASE_TYPES.map((t) => ({ value: t, label: RELEASE_TYPE_LABEL[t] })),
        },
        { name: 'release_date', placeholder: 'Release date', type: 'date', row: 1, width: 'grow' },
        { name: 'cover_url', placeholder: 'Cover image URL', type: 'url' },
      ]}
      preview={(v) => <ReleasePreview cover={v.cover_url} title={v.title} type={v.release_type} />}
      submit={(fd) => addReleaseAction(artistId, fd)}
    />
  )
}
