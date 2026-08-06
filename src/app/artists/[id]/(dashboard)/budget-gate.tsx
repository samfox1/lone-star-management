'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CardModal } from './card-modal'
import { buttonClass } from '@/components/ui/ui'
import {
  budgetVerdict,
  bytesLabel,
  type AssetBudget,
  type UploadKind,
} from '@/lib/site-editor/asset-budget'
import { compressImageFile, decodeEdgePx, type CompressedImage } from '@/lib/site-editor/compress-image'

/**
 * The gate a picked file passes through before upload (BRIEF-asset-compression.md,
 * skeen repo). `prepare(file)` resolves with the file to ACTUALLY upload:
 *
 *   • the original — within budget, no budget, or the manager declined
 *   • the compressed file — the manager accepted the proposal
 *   • null — cancelled, or gated (video/fonts/gif/svg over budget)
 *
 * The caller treats null as "do nothing" and otherwise uploads what it gets, so wiring
 * the gate into an uploader is one line around its existing onFile. Render `modal`
 * alongside the field; it is null until something is actually pending.
 */
type Pending =
  | { mode: 'compress'; original: File; mustCompress: boolean; proposal: CompressedImage | null }
  | { mode: 'gate'; original: File; kind: UploadKind }

export function useBudgetGate(
  kind: UploadKind,
  budget: AssetBudget | null | undefined,
): { prepare: (file: File) => Promise<File | null>; modal: ReactNode } {
  const [pending, setPending] = useState<Pending | null>(null)
  // The promise `prepare` returned, settled by whichever button the manager clicks.
  const resolver = useRef<((f: File | null) => void) | null>(null)

  async function prepare(file: File): Promise<File | null> {
    if (!budget) return file // no budget = no gate: the pre-budget behaviour, verbatim

    // Dimensions matter only for the compress path; a failed decode still gates on bytes.
    const edgePx = kind === 'image' ? await decodeEdgePx(file) : undefined
    const verdict = budgetVerdict({ size: file.size, type: file.type, edgePx }, kind, budget)
    if (verdict.action === 'upload') return file

    return new Promise<File | null>((resolve) => {
      resolver.current = resolve
      if (verdict.action === 'gate') {
        setPending({ mode: 'gate', original: file, kind })
        return
      }
      setPending({ mode: 'compress', original: file, mustCompress: verdict.mustCompress, proposal: null })
      // Compress EAGERLY so the modal can show the real numbers, not an estimate. On
      // failure fall through to the gate copy — a proposal we cannot produce must not
      // strand the promise or fake a result.
      compressImageFile(file, budget).then(
        (proposal) => setPending((p) => (p?.mode === 'compress' && p.original === file ? { ...p, proposal } : p)),
        () => setPending({ mode: 'gate', original: file, kind }),
      )
    })
  }

  const settle = (f: File | null) => {
    resolver.current?.(f)
    resolver.current = null
    setPending(null)
  }

  return {
    prepare,
    modal: pending ? <BudgetGateModal pending={pending} onSettle={settle} /> : null,
  }
}

/** What the gate tells a manager whose file is over budget, per kind. Plain words, one
 *  sentence per common tool — this is the whole value of gating over silently failing. */
const GATE_COPY: Record<UploadKind, { title: string; body: string }> = {
  video: {
    title: 'This video is too large for the site',
    body:
      'The browser can’t shrink video well, but your editor can: export at 1080p with the H.264 codec ' +
      '(in Premiere or Final Cut choose the “YouTube 1080p” preset; in QuickTime use File → Export As → 1080p). ' +
      'That usually lands a background clip well under the limit.',
  },
  font: {
    title: 'This font file is too large',
    body:
      'Convert it to WOFF2 — the web format fonts are meant to ship in. A free converter ' +
      '(search “woff2 converter”) typically shrinks a desktop TTF by 10× with no visual change.',
  },
  image: {
    title: 'This image can’t be compressed here',
    body:
      'Animated GIFs and SVGs would be damaged by re-encoding (a GIF keeps one frame; an SVG stops scaling). ' +
      'Export it smaller from its source, or use a video/static format instead.',
  },
}

function BudgetGateModal({ pending, onSettle }: { pending: Pending; onSettle: (f: File | null) => void }) {
  // Preview the COMPRESSED bytes, not the original: the question the manager is
  // answering is "is the result good enough", and only the result can answer it.
  const proposal = pending.mode === 'compress' ? pending.proposal : null
  // DERIVED, not staged in an effect (the repo bans setState-in-effect): the URL is a
  // pure function of the proposal file, created in a memo and revoked when it changes.
  const previewUrl = useMemo(() => {
    if (!proposal) return null
    try {
      return URL.createObjectURL(proposal.file)
    } catch {
      return null // jsdom / very old browsers: the numbers still tell the story
    }
  }, [proposal])
  useEffect(() => {
    if (!previewUrl) return
    return () => URL.revokeObjectURL(previewUrl)
  }, [previewUrl])

  if (pending.mode === 'gate') {
    const copy = GATE_COPY[pending.kind]
    return (
      <CardModal open onClose={() => onSettle(null)} footer={null}>
        <h2 className="font-space text-sm font-semibold uppercase tracking-wide">{copy.title}</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
          {pending.original.name} is {bytesLabel(pending.original.size)}. {copy.body}
        </p>
        <div className="mt-5 flex justify-end">
          <button type="button" className={buttonClass('ghost')} onClick={() => onSettle(null)}>
            Cancel
          </button>
        </div>
      </CardModal>
    )
  }

  return (
    <CardModal open onClose={() => onSettle(null)} footer={null}>
      <h2 className="font-space text-sm font-semibold uppercase tracking-wide">Make this file site-sized?</h2>
      {proposal ? (
        <>
          <p className="mt-2 font-space text-[13px] text-ink-muted">
            {bytesLabel(pending.original.size)} → {bytesLabel(proposal.file.size)} · {proposal.width}×{proposal.height}px
          </p>
          {previewUrl && (
            // The result at roughly slot size, so "did it survive?" is answered by eye.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt="Compressed preview" className="mt-3 max-h-48 w-full rounded object-contain bg-hairline-soft" />
          )}
          <div className="mt-5 flex items-center justify-end gap-2">
            <button type="button" className={buttonClass('ghost')} onClick={() => onSettle(null)}>
              Cancel
            </button>
            {/* The budget is a strong default, not a cage — EXCEPT past 4× over, where
                the original is never the right upload and the choice would be a trap. */}
            {!pending.mustCompress && (
              <button type="button" className={buttonClass('ghost')} onClick={() => onSettle(pending.original)}>
                Upload original
              </button>
            )}
            <button type="button" className={buttonClass('solid')} onClick={() => onSettle(proposal.file)}>
              Compress &amp; upload
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="mt-2 text-[13px] text-ink-muted">Preparing a smaller version…</p>
          <div className="mt-5 flex justify-end">
            <button type="button" className={buttonClass('ghost')} onClick={() => onSettle(null)}>
              Cancel
            </button>
          </div>
        </>
      )}
    </CardModal>
  )
}
