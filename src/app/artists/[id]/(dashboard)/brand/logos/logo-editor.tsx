'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BRAND_FOLDER, type BrandLogo } from '@/lib/brand'
import { analyzeLogo, removeFlatBackground, type LogoAnalysis, type LogoImage } from '@/lib/image-checks'
import { mediaThumbUrl, mediaUrl } from '@/lib/storage-url'
import { createClient } from '@/lib/supabase/client'
import { acceptFor, buildStoragePath, contentTypeFor, friendlyUploadError, IMAGE_UPLOAD_RULES, performUpload } from '@/lib/upload'
import { useConfirm } from '../../confirm-dialog'
import { toast } from '../../toast'
import { UploadField } from '../../upload-field'
import { BrandModal } from '../_ui/brand-modal'
import { ModalBoard, type BoardSwatch } from '../_ui/modal-board'
import { RowIcon } from '../_ui/row-icon'
import { addLogoAction, cutOutLogoAction, replaceLogoFileAction, setBrandAssetAction } from '../actions'
import { decodeLogo, encodePng, loadStoredLogo, objectUrl, revokeUrl } from './pixels'
import { removeLogo, removeQuestion, type BuiltInPurpose, type DerivedIcon } from './remove'
import { logoWarnings, NOT_FLAT_TEXT } from './warnings'

/** What the editor is open on: a built-in slot (maybe empty), an added logo, or an added
 *  row that has no file yet (client-only until its upload lands). */
export type LogoTarget =
  | { kind: 'builtin'; purpose: BuiltInPurpose; title: string; logo: BrandLogo | null }
  | { kind: 'added'; title: string; logo: BrandLogo }
  | { kind: 'pending'; title: string; note: string }

/** The logo on the board, decoded — what the warnings describe and what the cut-out works
 *  on: the stored logo, checked when the editor opens, or the file just uploaded. */
type Fresh = { image: LogoImage; analysis: LogoAnalysis }

/**
 * THE LOGO EDITOR (Sam, 2026-09-23, BRAND_PAGE_PLAN.md): ONE column, the card hugging the
 * 320px board (BrandModal `fit`). Under the board, one bar: + (Upload new / Add logo)
 * bottom-left, the background circles centred (Transparent · Light · Dark · one per brand
 * colour), trash (Remove, disabled when empty) bottom-right. Warnings stack under that.
 * NO sliders on logos.
 *
 * The upload is UploadField in trigger mode, so the compression gate is composed where it
 * always is, with the old LogoRow's rules: bucket `media`, the brand folder, the image
 * allowlist (never SVG — a script vector on a public bucket). Where the file lands:
 *   empty built-in  → setBrandAssetAction (the slot's first file)
 *   any saved logo  → replaceLogoFileAction (same row: its id, title, note, and any icon
 *                     framed from it, survive — a vacate-then-insert would orphan them)
 *   a pending row   → addLogoAction(title, note, path): the row is saved NOW, and only now
 *
 * The logo is decoded and checked (lib/image-checks.ts) when the editor opens on a stored
 * one, and again after every upload — the later check always wins (`seq`). A flat opaque
 * background gets the eraser: the cut-out runs here, in the browser, shows on the board
 * at once, uploads as a PNG and goes through cutOutLogoAction, which keeps the original.
 * Every refusal is an error toast; a success says nothing (the board is the answer).
 */
export function LogoEditor({
  artistId,
  target,
  swatches,
  derivedIcons,
  onClose,
  onAdded,
  onRemoved,
}: {
  artistId: string
  target: LogoTarget
  swatches: BoardSwatch[]
  /** Icons made from the primary logo, which go with it (see remove.ts). */
  derivedIcons: readonly DerivedIcon[]
  onClose: () => void
  /** A pending row got its file and is now this saved logo. */
  onAdded?: (logo: BrandLogo) => void
  /** An added logo was removed — its row is gone, so the editor should close. */
  onRemoved?: (id: string) => void
}) {
  const router = useRouter()
  const { ask, dialog } = useConfirm()
  const [bg, setBg] = useState('transparent')
  /** What the board shows before the server's refresh arrives: the file just uploaded,
   *  or the cut-out just made. */
  const [preview, setPreview] = useState<string | null>(null)
  const [fresh, setFresh] = useState<Fresh | null>(null)
  const [cutting, setCutting] = useState(false)
  const [removing, setRemoving] = useState(false)
  // Re-entry latches are refs (AGENTS.md rule 5): two clicks in one tick both read the
  // state from before either landed.
  const cutRef = useRef(false)
  const removeRef = useRef(false)
  /** A pending row's add is in flight or done: a second file must not add a second row. */
  const addedRef = useRef(false)
  /** Which upload's decode may still write its warnings (a later upload wins). */
  const seq = useRef(0)
  const urls = useRef<string[]>([])
  useEffect(() => {
    const made = urls.current
    return () => made.forEach(revokeUrl)
  }, [])

  /** The stored file the editor OPENED on. Checked once: a later upload or cut-out is
   *  checked from its own pixels, so re-fetching what the refresh brings would only
   *  repeat that. */
  const openedOn = useRef(target.kind === 'pending' ? null : (target.logo?.storagePath ?? null))
  useEffect(() => {
    const path = openedOn.current
    if (!path) return
    const mine = ++seq.current
    let live = true
    void loadStoredLogo(mediaUrl(path)).then((got) => {
      if (!live || mine !== seq.current || !got) return
      setFresh({ image: got.image, analysis: analyzeLogo(got.image, got.bytes) })
    })
    return () => {
      live = false
    }
  }, [])

  const logo = target.kind === 'pending' ? null : target.logo
  const title = target.title
  const serverUrl = logo ? mediaThumbUrl(logo.storagePath, { size: 640 }) : null
  const shown = preview ?? serverUrl

  function show(blob: Blob) {
    const url = objectUrl(blob)
    if (url) urls.current.push(url)
    setPreview(url)
  }

  /** Decode what was just stored and say what is wrong with it, if anything. */
  async function inspect(file: File) {
    const mine = ++seq.current
    show(file)
    setFresh(null)
    const image = await decodeLogo(file)
    if (mine !== seq.current || !image) return
    setFresh({ image, analysis: analyzeLogo(image, file.size) })
  }

  /** performUpload's writeRow: an error string means nothing was written and the object
   *  is deleted again (useStorageUpload then toasts it as an error). */
  async function writeRow(path: string, file: File): Promise<string | null> {
    if (target.kind === 'pending') {
      if (addedRef.current) return 'That logo is already being saved.'
      addedRef.current = true
      const res = await addLogoAction(artistId, { title: target.title, note: target.note || null, storagePath: path })
      if (res.error || !res.logo) {
        addedRef.current = false
        return res.error ?? 'Could not save that logo.'
      }
      onAdded?.(res.logo)
    } else {
      const res =
        target.kind === 'builtin' && !target.logo
          ? await setBrandAssetAction(artistId, target.purpose, path)
          : await replaceLogoFileAction(artistId, target.logo!.id, path)
      if (res.error) return res.error
    }
    void inspect(file)
    return null
  }

  async function remove() {
    if (!logo || removeRef.current) return
    removeRef.current = true
    try {
      const which = target.kind === 'builtin' ? ({ kind: 'builtin', purpose: target.purpose } as const) : ({ kind: 'added', id: logo.id } as const)
      if (!(await ask(removeQuestion(which, title, derivedIcons), { action: 'Remove' }))) return
      setRemoving(true)
      const res = await removeLogo(artistId, which, derivedIcons)
      if (res.error) {
        toast(res.error, 'error')
        return
      }
      seq.current++
      setPreview(null)
      setFresh(null)
      router.refresh()
      if (which.kind === 'added') onRemoved?.(which.id)
    } finally {
      removeRef.current = false
      setRemoving(false)
    }
  }

  async function cutOut() {
    const id = logo?.id
    if (!fresh || !id || cutRef.current) return
    cutRef.current = true
    setCutting(true)
    const before = preview
    try {
      const cut = removeFlatBackground(fresh.image)
      if (!cut) {
        toast(NOT_FLAT_TEXT, 'error')
        return
      }
      const blob = await encodePng(cut)
      if (!blob) {
        toast("Couldn't remove the background.", 'error')
        return
      }
      show(blob) // on the board at once, before the upload
      const path = buildStoragePath(artistId, BRAND_FOLDER, 'png')
      const refusal: { error: string | null } = { error: null }
      const res = await performUpload({
        supabase: createClient() as never,
        bucket: 'media',
        path,
        file: blob,
        contentType: contentTypeFor('png'),
        writeRow: async (p) => (refusal.error = (await cutOutLogoAction(artistId, id, p)).error ?? null),
      })
      if ('error' in res) {
        setPreview(before)
        // The action's own sentence when it was the one that said no; a storage failure
        // gets the same wording every uploader uses.
        toast(refusal.error ?? friendlyUploadError(res.error, { noun: 'logo' }), 'error')
        return
      }
      seq.current++
      setFresh({ image: cut, analysis: analyzeLogo(cut, blob.size) })
      router.refresh()
    } catch {
      setPreview(before)
      toast("Couldn't remove the background.", 'error')
    } finally {
      cutRef.current = false
      setCutting(false)
    }
  }

  const warnings = fresh ? logoWarnings(fresh.analysis) : []
  const upload = (
        <UploadField
          accept={acceptFor(IMAGE_UPLOAD_RULES)}
          label={`${title} file`}
          kind="image"
          budget={null}
          bucket="media"
          artistId={artistId}
          category={BRAND_FOLDER}
          noun="logo"
          rules={IMAGE_UPLOAD_RULES}
          successMessage={`${title} uploaded`}
          writeRow={writeRow}
          trigger={(pick, { busy }) => (
            <RowIcon icon="plus" label={shown ? 'Upload new' : 'Add logo'} variant="boxed" labelSide="top" onClick={pick} disabled={busy || cutting || removing} />
          )}
        />
  )

  return (
    <BrandModal
      label={title}
      meta="edit"
      fit
      onClose={onClose}
      board={
        <ModalBoard
          value={bg}
          onChange={setBg}
          swatches={swatches}
          start={upload}
          end={<RowIcon icon="trash" label="Remove" variant="boxed" tone="danger" labelSide="top" onClick={() => void remove()} disabled={!logo || cutting || removing} />}
        >
          {shown ? (
            // eslint-disable-next-line @next/next/no-img-element -- a storage render URL or a local preview
            <img src={shown} alt={title} data-board-logo="" className="max-h-[85%] max-w-[85%] object-contain" />
          ) : (
            <span className="rounded-lg bg-paper px-3 py-1.5 text-[14px] text-ink-muted">
              {target.kind === 'builtin' ? `No ${title.toLowerCase()} yet` : 'No logo yet'}
            </span>
          )}
        </ModalBoard>
      }
    >

      {warnings.length > 0 ? (
        <ul aria-label="Upload warnings" className="flex flex-col gap-2">
          {warnings.map((w) => (
            <li key={w.key} className="flex items-center gap-3 rounded-[10px] border border-hairline px-3 py-2.5 text-[13px] text-ink">
              <span aria-hidden="true" className="h-[7px] w-[7px] flex-none rounded-full bg-accent-red" />
              <span className="min-w-0 flex-1">{w.text}</span>
              {w.key === 'flat' ? (
                // The lowest control in the modal: its label opens ABOVE (BRAND_PAGE_PLAN).
                // At the modal's right edge, so its label hangs left from it (labelAlign end).
                <RowIcon icon="eraser" label="Remove background" variant="boxed" size="sm" labelSide="top" labelAlign="end" onClick={() => void cutOut()} disabled={!logo || cutting} />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {dialog}
    </BrandModal>
  )
}
