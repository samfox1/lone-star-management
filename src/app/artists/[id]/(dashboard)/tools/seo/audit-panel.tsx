'use client'

/**
 * "Run check": fetch the public site as a crawler would and show every findability rule
 * as pass / fail, plus what the fact sheet states. The proof that a change shipped —
 * the tools further down (Search Console, the AI probe) are the proof it mattered.
 */
import { useRef, useState } from 'react'
import { Button, KLabel } from '@/components/ui/ui'
import { Icon } from '@/components/ui/icons'
import { runSeoAuditAction } from '../../actions'
import type { LiveAudit } from '@/lib/seo-audit'

const GRAPH_LABEL: Record<string, string> = {
  MusicGroup: 'artist',
  Person: 'artist',
  WebSite: 'site',
  MusicEvent: 'upcoming shows',
  MusicAlbum: 'releases',
  VideoObject: 'videos',
  ImageObject: 'photos',
  VisualArtwork: 'artworks',
}

export function AuditPanel({ artistId, siteUrl }: { artistId: string; siteUrl: string | null }) {
  const [result, setResult] = useState<LiveAudit | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const run = async () => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      setResult(await runSeoAuditAction(artistId))
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={run} disabled={busy || !siteUrl}>
          {busy ? 'Checking…' : 'Run check'}
        </Button>
        {siteUrl ? (
          <span className="font-space text-xs text-ink-faint">{siteUrl}</span>
        ) : (
          <span className="font-space text-xs text-status-pending">No public site URL yet.</span>
        )}
        {result && !result.error && (
          <span className={`font-space text-xs font-bold ${result.ok ? 'text-ink' : 'text-accent-red'}`}>
            {result.ok ? 'All clear' : `${result.rules.filter((r) => r.problems.length).length} to fix`}
          </span>
        )}
      </div>
      {result?.error && <p className="font-space text-xs text-accent-red">{result.error}</p>}
      {result && !result.error && (
        <div className="grid gap-6 md:grid-cols-[1fr_260px]">
          <ul className="divide-y divide-hairline rounded-xl border border-hairline">
            {result.rules.map((r) => (
              <li key={r.rule} className="flex items-start gap-3 px-4 py-2.5">
                <span className={`mt-0.5 flex-none ${r.problems.length ? 'text-accent-red' : 'text-ink'}`}>
                  <Icon name={r.problems.length ? 'alert' : 'check'} size={14} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm">{r.label}</div>
                  {r.problems.map((p, i) => (
                    <div key={i} className="mt-0.5 break-words font-space text-[11px] text-ink-muted">
                      {p}
                    </div>
                  ))}
                </div>
              </li>
            ))}
          </ul>
          <div className="space-y-4">
            <div>
              <KLabel>Fact sheet states</KLabel>
              <ul className="mt-2 space-y-1 font-space text-xs">
                {Object.entries(result.graph).map(([type, n]) => (
                  <li key={type} className="flex justify-between gap-3">
                    <span className="text-ink-muted">{GRAPH_LABEL[type] ?? type}</span>
                    <span className="font-bold">{n}</span>
                  </li>
                ))}
                {!Object.keys(result.graph).length && <li className="text-ink-faint">nothing</li>}
              </ul>
            </div>
            <div>
              <KLabel>Sitemap</KLabel>
              <ul className="mt-2 space-y-1 font-space text-xs">
                {result.sitemap ? (
                  <>
                    {result.sitemap.urls.map((u) => (
                      <li key={u} className="truncate text-ink-muted">
                        {u.replace(result.url, '') || '/'}
                      </li>
                    ))}
                    <li className="text-ink-faint">last change {result.sitemap.lastmod?.slice(0, 10) ?? 'unknown'}</li>
                  </>
                ) : (
                  <li className="text-accent-red">no sitemap.xml</li>
                )}
                <li className={result.robots?.sitemap ? 'text-ink-faint' : 'text-accent-red'}>
                  robots.txt {result.robots ? (result.robots.sitemap ? 'names the sitemap' : 'does not name the sitemap') : 'missing'}
                </li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
