'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'
import { buttonClass, modalCardClass, modalOverlayClass, modalCornerGlyphClass } from '@/components/ui/ui'
import { useLockBodyScroll } from '@/components/ui/use-lock-body-scroll'
import { CONNECTIONS, buttonChoices, connectionHandle, connectionOfLink } from '@/lib/connections'
import { ConnectModal } from '../(manager-tools)/connections/connect-modal'
import { ConnectionMark } from '../(manager-tools)/_ui/connection-mark'
import type { EditorLink } from './inspector-types'

/** What Connect offers from here: the socials that can be a button. A service is never a
 *  site button, and neither is an identity connection (MusicBrainz, Discogs, Wikidata). */
const SOCIALS = CONNECTIONS.filter((d) => d.social && !d.identityOnly)

/**
 * ADD A BUTTON (Sam, 2026-09-28): "when the connection is added, and I travel to the socials
 * list in the site editor, I can add a new button based on one of the existing connections
 * that I have… it should reference the link provided by the connection."
 *
 * The picker is the artist's connections that have a profile link and are not on the site
 * yet (lib/connections `buttonChoices`), as the Connect grid draws them: mark, name, and the
 * handle under it. Nothing is typed. Picking one hands back THAT links row, and the caller
 * turns it on — so the button is the connection's own link, and an edit in Connections is
 * an edit to the button.
 *
 * With nothing left to pick it says so in one line. Either way "Connect an account" opens
 * the Connections tool's own Connect modal right here, socials only; leaving it refreshes
 * the page, and what was connected comes back as a choice (it lands off the site).
 *
 * Both wear the dashboard's UI face, not the inspector's mono, so Connect looks here as it
 * does on its own page.
 */
export function AddButtonModal({
  artistId,
  links,
  onPick,
  onCancel,
}: {
  artistId: string
  /** The artist's social links, on the site and off it. */
  links: EditorLink[]
  onPick: (link: EditorLink) => void
  onCancel: () => void
}) {
  const router = useRouter()
  const [connecting, setConnecting] = useState(false)

  if (connecting) {
    const taken = [...new Set(links.flatMap((l) => connectionOfLink(l)?.key ?? []))]
    return (
      <div className="font-ui">
        <ConnectModal
          artistId={artistId}
          defs={SOCIALS}
          taken={taken}
          onClose={() => setConnecting(false)}
          onDone={() => router.refresh()}
        />
      </div>
    )
  }
  return <ButtonPicker links={links} onPick={onPick} onConnect={() => setConnecting(true)} onCancel={onCancel} />
}

function ButtonPicker({
  links,
  onPick,
  onConnect,
  onCancel,
}: {
  links: EditorLink[]
  onPick: (link: EditorLink) => void
  onConnect: () => void
  onCancel: () => void
}) {
  useLockBodyScroll(true)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  const choices = buttonChoices(links)

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add button"
      className={cx(modalOverlayClass, 'font-ui')}
      onMouseDown={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div className={cx(modalCardClass, 'gap-0')}>
        {/* The × 16px in from the corner, as on every card (card-modal.tsx), so the tiles
            start right under it. */}
        <div className="-mr-3 -mt-3 flex justify-end">
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            className={modalCornerGlyphClass}
          >
            <Icon name="close" size={16} />
          </button>
        </div>

        {choices.length ? (
          <div className="mt-1 grid grid-cols-3 gap-2">
            {choices.map(({ def, link }) => (
              <button
                key={link.id}
                type="button"
                data-connection={def.label}
                onClick={() => onPick(link)}
                className="flex min-h-[82px] min-w-0 flex-col items-start justify-end gap-1 rounded-xl border border-hairline p-3 text-left text-ink transition-colors hover:border-ink-faint"
              >
                <ConnectionMark def={def} size={22} className="mb-1.5" />
                <span className="w-full truncate text-[13px] font-semibold">{def.label}</span>
                <span className="w-full truncate font-space text-[11px] text-ink-muted">{connectionHandle(def, link.url)}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="mt-1 text-sm text-ink-muted">No connected accounts left to add.</p>
        )}

        <div className="mt-6 flex justify-end">
          <button type="button" onClick={onConnect} className={buttonClass('confirm')}>
            <Icon name="plus" size={12} /> Connect an account
          </button>
        </div>
      </div>
    </div>
  )
}
