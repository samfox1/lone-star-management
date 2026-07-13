'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { cx } from '@/lib/cx'
import { mediaUrl } from '@/lib/site'
import { reorderList } from '@/lib/site-editor/gallery'
import { Icon, type IconName } from '@/components/ui/icons'
import { MediaUploader } from '../media-uploader'
import {
  deleteContentAction,
  deleteMediaAction,
  renameVideoAction,
  reorderContentAction,
  reorderGalleryAction,
  saveEditorFieldAction,
  updateContentAction,
} from '../actions'

/**
 * The visual editor's LEFT inspector (SITE_EDITOR_PLAN.md phase 2 — panel redesign).
 * Two states: BROWSE (a breathable list of the site's component types) and EDITING
 * (the tools for the selected component, with the browse list collapsed to an icon
 * strip at the bottom).
 *
 * Wiring status: the Images tools read the artist's real `gallery_image` media and
 * remove is wired to `deleteMediaAction`. Reorder + sizing (no schema yet) and the
 * other component types still render against placeholder affordances — next step.
 */

export type GalleryPhoto = { id: string; storage_path: string }
export type EditorTextField = {
  key: string
  label: string
  type: 'text' | 'email'
  value: string
  multiline: boolean
}
export type EditorLink = { id: string; label: string; url: string }
export type EditorVideo = { id: string; title: string; provider: string | null; poster: string | null }
export type EditorMerch = { id: string; title: string; price: string; url: string; image_url: string | null }
export type EditorSong = { id: string; title: string; cover_url: string | null; released: boolean }

type Kind = 'images' | 'text' | 'links' | 'videos' | 'music' | 'merch'
type Component = { kind: Kind; icon: IconName; label: string; caption: string }

const COMPONENTS: Component[] = [
  { kind: 'images', icon: 'photo', label: 'Images', caption: 'Photo gallery' },
  { kind: 'text', icon: 'text', label: 'Text', caption: 'Headings & copy' },
  { kind: 'links', icon: 'links', label: 'Links', caption: 'Outbound links' },
  { kind: 'videos', icon: 'videos', label: 'Videos', caption: '6 videos' },
  { kind: 'music', icon: 'tracks', label: 'Music', caption: '1 album · 9 songs' },
  { kind: 'merch', icon: 'merch', label: 'Merch', caption: '4 products' },
]

const EYEBROW = 'font-space text-[10px] font-bold uppercase tracking-[0.12em] text-ink-faint'
// Red ring for a field whose value the server would reject (a blank required field, a
// bad price) — gating the save so the panel can't claim "Saved" on a dropped write.
const INVALID_RING = 'border-accent-red focus:border-accent-red'

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'
/**
 * Run a field's save SERIALIZED per id (chained onto that field's previous save, so an
 * older keystroke's write can't land after a newer one — review #6), and reflect the
 * result honestly across concurrent fields via an `errored` set, so one field's failure
 * isn't masked by another field's later success (review #8).
 */
export function runSerialized(
  saving: { current: Map<string, Promise<unknown>> },
  errored: { current: Set<string> },
  setStatus: (s: SaveStatus) => void,
  id: string,
  action: () => Promise<{ error?: string } | void>,
): void {
  // Fire immediately when this field has no save in flight; only CHAIN behind a prior
  // one (so overlapping saves of the same field can't land out of order).
  const prev = saving.current.get(id)
  const settled = Promise.resolve(prev ? prev.then(() => action()) : action())
  saving.current.set(id, settled.catch(() => {}))
  void settled.then((res) => {
    if (res && (res as { error?: string }).error) errored.current.add(id)
    else errored.current.delete(id)
    setStatus(errored.current.size ? 'error' : 'saved')
  })
}

function photoCount(n: number) {
  return `${n} ${n === 1 ? 'photo' : 'photos'}`
}
function fieldCount(n: number) {
  return `${n} ${n === 1 ? 'field' : 'fields'}`
}
function linkLabel(n: number) {
  return `${n} ${n === 1 ? 'link' : 'links'}`
}
function videoLabel(n: number) {
  return `${n} ${n === 1 ? 'video' : 'videos'}`
}
function merchLabel(n: number) {
  return `${n} ${n === 1 ? 'product' : 'products'}`
}
function songLabel(n: number) {
  return `${n} ${n === 1 ? 'song' : 'songs'}`
}

export function EditorInspector({
  artistId,
  photos: initial,
  textFields = [],
  links: initialLinks = [],
  videos: initialVideos = [],
  merch: initialMerch = [],
  songs: initialSongs = [],
  onApplyField,
}: {
  artistId: string
  photos: GalleryPhoto[]
  textFields?: EditorTextField[]
  links?: EditorLink[]
  videos?: EditorVideo[]
  merch?: EditorMerch[]
  songs?: EditorSong[]
  onApplyField?: (key: string, value: string) => void
}) {
  const [active, setActive] = useState<Component | null>(null)
  const [photos, setPhotos] = useState<GalleryPhoto[]>(initial)
  const [links, setLinks] = useState<EditorLink[]>(initialLinks)
  const [videos, setVideos] = useState<EditorVideo[]>(initialVideos)
  const [merch, setMerch] = useState<EditorMerch[]>(initialMerch)
  const [songs, setSongs] = useState<EditorSong[]>(initialSongs)
  // One in-flight list mutation at a time: overlapping optimistic ops would each
  // capture a whole-array `prev`, and a later failure would revert to a snapshot that
  // predates a concurrent success — resurrecting a removed row / dropping a good change.
  const [isPending, startTransition] = useTransition()

  function removePhoto(p: GalleryPhoto) {
    if (isPending) return
    const prev = photos
    setPhotos((list) => list.filter((x) => x.id !== p.id)) // optimistic
    startTransition(async () => {
      const res = await deleteMediaAction(p.id, p.storage_path, artistId)
      if (res?.error) setPhotos(prev) // revert on failure
    })
  }

  function reorderPhotos(from: number, to: number) {
    if (isPending) return
    const prev = photos
    const next = reorderList(photos, from, to)
    setPhotos(next) // optimistic
    startTransition(async () => {
      const res = await reorderGalleryAction(artistId, next.map((p) => p.id))
      if (res?.error) setPhotos(prev) // revert on failure
    })
  }

  // The uploader already wrote the media row (and router.refresh'd); append it to the
  // grid so it shows without waiting on a prop re-sync. New uploads sort last.
  function addPhoto(m: GalleryPhoto) {
    setPhotos((list) => (list.some((x) => x.id === m.id) ? list : [...list, m]))
  }

  function removeLink(l: EditorLink) {
    if (isPending) return
    const prev = links
    setLinks((list) => list.filter((x) => x.id !== l.id)) // optimistic
    startTransition(async () => {
      const res = await deleteContentAction('link', l.id, artistId)
      if (res?.error) setLinks(prev)
    })
  }

  function reorderLinks(from: number, to: number) {
    if (isPending) return
    const prev = links
    const next = reorderList(links, from, to)
    setLinks(next) // optimistic
    startTransition(async () => {
      const res = await reorderContentAction('link', artistId, next.map((l) => l.id))
      if (res?.error) setLinks(prev)
    })
  }

  function removeVideo(v: EditorVideo) {
    if (isPending) return
    const prev = videos
    setVideos((list) => list.filter((x) => x.id !== v.id)) // optimistic
    startTransition(async () => {
      const res = await deleteContentAction('video', v.id, artistId)
      if (res?.error) setVideos(prev)
    })
  }

  function reorderVideos(from: number, to: number) {
    if (isPending) return
    const prev = videos
    const next = reorderList(videos, from, to)
    setVideos(next) // optimistic
    startTransition(async () => {
      const res = await reorderContentAction('video', artistId, next.map((v) => v.id))
      if (res?.error) setVideos(prev)
    })
  }

  function removeMerch(m: EditorMerch) {
    if (isPending) return
    const prev = merch
    setMerch((list) => list.filter((x) => x.id !== m.id)) // optimistic
    startTransition(async () => {
      const res = await deleteContentAction('merch', m.id, artistId)
      if (res?.error) setMerch(prev)
    })
  }

  function removeSong(s: EditorSong) {
    if (isPending) return
    const prev = songs
    setSongs((list) => list.filter((x) => x.id !== s.id)) // optimistic
    startTransition(async () => {
      const res = await deleteContentAction('track', s.id, artistId)
      if (res?.error) setSongs(prev)
    })
  }

  function reorderSongs(from: number, to: number) {
    if (isPending) return
    const prev = songs
    const next = reorderList(songs, from, to)
    setSongs(next) // optimistic
    startTransition(async () => {
      const res = await reorderContentAction('track', artistId, next.map((s) => s.id))
      if (res?.error) setSongs(prev)
    })
  }

  return (
    <aside className="flex w-[344px] flex-none flex-col overflow-hidden border-r border-hairline bg-paper">
      {active ? (
        <EditingView
          component={active}
          photos={photos}
          textFields={textFields}
          links={links}
          videos={videos}
          merch={merch}
          songs={songs}
          artistId={artistId}
          onRemove={removePhoto}
          onReorder={reorderPhotos}
          onAddPhoto={addPhoto}
          onRemoveLink={removeLink}
          onReorderLink={reorderLinks}
          onRemoveVideo={removeVideo}
          onReorderVideo={reorderVideos}
          onRemoveMerch={removeMerch}
          onRemoveSong={removeSong}
          onReorderSong={reorderSongs}
          onApplyField={onApplyField}
          onBack={() => setActive(null)}
          onSwitch={setActive}
        />
      ) : (
        <BrowseView
          imageCount={photos.length}
          textCount={textFields.length}
          linkCount={links.length}
          videoCount={videos.length}
          merchCount={merch.length}
          songCount={songs.length}
          onOpen={setActive}
        />
      )}
    </aside>
  )
}

/* ── Browse: the component-type list ─────────────────────────────────────────── */
function BrowseView({
  imageCount,
  textCount,
  linkCount,
  videoCount,
  merchCount,
  songCount,
  onOpen,
}: {
  imageCount: number
  textCount: number
  linkCount: number
  videoCount: number
  merchCount: number
  songCount: number
  onOpen: (c: Component) => void
}) {
  return (
    <>
      <div className="px-5 pb-3.5 pt-5">
        <div className={EYEBROW}>Editor</div>
        <h2 className="mt-2 text-[19px] font-semibold tracking-[-0.01em]">Edit your site</h2>
      </div>
      <div className="flex-1 overflow-y-auto border-t border-hairline-soft">
        {COMPONENTS.map((c) => (
          <button
            key={c.kind}
            type="button"
            onClick={() => onOpen(c)}
            className="group flex w-full items-center gap-3.5 border-b border-hairline-soft px-5 py-[15px] text-left hover:bg-surface"
          >
            <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[9px] bg-track text-ink-muted group-hover:text-ink">
              <Icon name={c.icon} size={19} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-sm font-medium">{c.label}</span>
              <span className="font-space text-[10px] tracking-[0.04em] text-ink-faint">
                {c.kind === 'images'
                  ? photoCount(imageCount)
                  : c.kind === 'text'
                    ? fieldCount(textCount)
                    : c.kind === 'links'
                      ? linkLabel(linkCount)
                      : c.kind === 'videos'
                        ? videoLabel(videoCount)
                        : c.kind === 'merch'
                          ? merchLabel(merchCount)
                          : c.kind === 'music'
                            ? songLabel(songCount)
                            : c.caption}
              </span>
            </span>
            <Icon name="chevronRight" size={16} className="flex-none text-hairline" />
          </button>
        ))}
      </div>
    </>
  )
}

/* ── Editing: tools for the selected component ───────────────────────────────── */
function EditingView({
  component,
  photos,
  textFields,
  links,
  videos,
  merch,
  songs,
  artistId,
  onRemove,
  onReorder,
  onAddPhoto,
  onRemoveLink,
  onReorderLink,
  onRemoveVideo,
  onReorderVideo,
  onRemoveMerch,
  onRemoveSong,
  onReorderSong,
  onApplyField,
  onBack,
  onSwitch,
}: {
  component: Component
  photos: GalleryPhoto[]
  textFields: EditorTextField[]
  links: EditorLink[]
  videos: EditorVideo[]
  merch: EditorMerch[]
  songs: EditorSong[]
  artistId: string
  onRemove: (p: GalleryPhoto) => void
  onReorder: (from: number, to: number) => void
  onAddPhoto: (m: GalleryPhoto) => void
  onRemoveLink: (l: EditorLink) => void
  onReorderLink: (from: number, to: number) => void
  onRemoveVideo: (v: EditorVideo) => void
  onReorderVideo: (from: number, to: number) => void
  onRemoveMerch: (m: EditorMerch) => void
  onRemoveSong: (s: EditorSong) => void
  onReorderSong: (from: number, to: number) => void
  onApplyField?: (key: string, value: string) => void
  onBack: () => void
  onSwitch: (c: Component) => void
}) {
  const isImages = component.kind === 'images'
  const isText = component.kind === 'text'
  const isLinks = component.kind === 'links'
  const isVideos = component.kind === 'videos'
  const isMerch = component.kind === 'merch'
  const isMusic = component.kind === 'music'
  return (
    <>
      <button
        type="button"
        onClick={onBack}
        className={cx('flex items-center gap-1.5 px-5 pb-2.5 pt-[15px] text-ink-muted hover:text-ink', EYEBROW)}
      >
        <Icon name="chevronLeft" size={15} />
        All components
      </button>

      <div className="flex items-center gap-3 border-b border-hairline px-5 pb-4 pt-0.5">
        <span className="flex h-10 w-10 flex-none items-center justify-center rounded-[11px] bg-accent-soft text-accent">
          <Icon name={component.icon} size={20} />
        </span>
        <span className="flex flex-col gap-0.5">
          <span className="text-base font-semibold">{isImages ? 'Gallery' : component.label}</span>
          <span className={EYEBROW}>
            {isImages
              ? photoCount(photos.length)
              : isText
                ? fieldCount(textFields.length)
                : isLinks
                  ? linkLabel(links.length)
                  : isVideos
                    ? videoLabel(videos.length)
                    : isMerch
                      ? merchLabel(merch.length)
                      : isMusic
                        ? songLabel(songs.length)
                        : component.caption}
          </span>
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isImages ? (
          <PhotoTools
            photos={photos}
            artistId={artistId}
            onRemove={onRemove}
            onReorder={onReorder}
            onAdd={onAddPhoto}
          />
        ) : isText ? (
          <TextTools textFields={textFields} artistId={artistId} onApplyField={onApplyField} />
        ) : isLinks ? (
          <LinkTools links={links} artistId={artistId} onRemove={onRemoveLink} onReorder={onReorderLink} />
        ) : isVideos ? (
          <VideoTools videos={videos} artistId={artistId} onRemove={onRemoveVideo} onReorder={onReorderVideo} />
        ) : isMerch ? (
          <MerchTools merch={merch} artistId={artistId} onRemove={onRemoveMerch} />
        ) : isMusic ? (
          <MusicTools songs={songs} artistId={artistId} onRemove={onRemoveSong} onReorder={onReorderSong} />
        ) : (
          <p className="px-5 py-6 text-sm text-ink-muted">
            Editing tools for {component.label} are coming next.
          </p>
        )}
      </div>

      {/* the browse list, collapsed to a switcher strip */}
      <div className="flex items-center justify-between gap-0.5 border-t border-hairline bg-surface px-4 py-2.5">
        {COMPONENTS.map((c) => (
          <button
            key={c.kind}
            type="button"
            aria-label={c.label}
            aria-current={c.kind === component.kind ? 'true' : undefined}
            onClick={() => onSwitch(c)}
            className={cx(
              'flex h-8 w-9 items-center justify-center rounded-lg transition-colors',
              c.kind === component.kind
                ? 'bg-accent-soft text-accent'
                : 'text-ink-faint hover:bg-paper hover:text-ink',
            )}
          >
            <Icon name={c.icon} size={17} />
          </button>
        ))}
      </div>
    </>
  )
}

/* ── Photo-collection tools (accordion) ──────────────────────────────────────── */
function PhotoTools({
  photos,
  artistId,
  onRemove,
  onReorder,
  onAdd,
}: {
  photos: GalleryPhoto[]
  artistId: string
  onRemove: (p: GalleryPhoto) => void
  onReorder: (from: number, to: number) => void
  onAdd: (m: GalleryPhoto) => void
}) {
  const [open, setOpen] = useState({ photos: true, sizing: true, layout: true })
  const [perImage, setPerImage] = useState<'S' | 'M' | 'L'>('M')
  const [display, setDisplay] = useState<'Grid' | 'Rows' | 'Masonry'>('Grid')
  const [columns, setColumns] = useState(2)
  const [size, setSize] = useState(55)
  const dragFrom = useRef<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)
  const toggle = (k: keyof typeof open) => setOpen((o) => ({ ...o, [k]: !o[k] }))

  function drop(to: number) {
    const from = dragFrom.current
    dragFrom.current = null
    setDragOver(null)
    if (from !== null && from !== to) onReorder(from, to)
  }

  return (
    <>
      <Section title="Photos" open={open.photos} onToggle={() => toggle('photos')} extra={<Pill>{photos.length}</Pill>}>
        <div className="grid grid-cols-2 gap-2.5">
          {photos.map((p, i) => (
            <div
              key={p.id}
              draggable
              onDragStart={() => (dragFrom.current = i)}
              onDragEnter={() => setDragOver(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => drop(i)}
              onDragEnd={() => {
                dragFrom.current = null
                setDragOver(null)
              }}
              className={cx(
                'group relative overflow-hidden rounded-lg',
                dragOver === i && 'ring-2 ring-accent',
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={mediaUrl(p.storage_path)} alt="" className="aspect-[4/3] w-full rounded-lg object-cover" />
              <span className="absolute left-1.5 top-1.5 hidden cursor-grab rounded-md bg-black/35 p-0.5 text-white group-hover:flex">
                <Icon name="grip" size={16} />
              </span>
              <button
                type="button"
                aria-label={`Remove photo ${i + 1}`}
                onClick={() => onRemove(p)}
                className="absolute right-1.5 top-1.5 hidden rounded-md bg-black/35 p-1 text-white hover:bg-accent-red group-hover:flex"
              >
                <Icon name="trash" size={14} />
              </button>
            </div>
          ))}
        </div>
        <div className="mt-2.5">
          <MediaUploader
            artistId={artistId}
            purpose="gallery_image"
            folder="gallery"
            accept="image/*"
            label="Drop images or click to upload"
            onUploaded={onAdd}
          />
        </div>
      </Section>

      <Section title="Sizing" open={open.sizing} onToggle={() => toggle('sizing')}>
        <div className={cx(EYEBROW, 'mb-2')}>Collection size</div>
        <div className="flex items-center gap-3">
          <span className="font-space text-[11px] text-ink-faint">S</span>
          <input
            type="range"
            min={0}
            max={100}
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
            aria-label="Collection size"
            className="h-1 flex-1 accent-[#2563eb]"
          />
          <span className="font-space text-[11px] text-ink-faint">L</span>
        </div>

        <div className={cx(EYEBROW, 'mb-2 mt-4')}>Selected image</div>
        <div className="flex items-center gap-3">
          <div className="h-10 w-[52px] flex-none rounded-md bg-track" />
          <Segmented options={['S', 'M', 'L']} value={perImage} onChange={setPerImage} />
        </div>
      </Section>

      <Section title="Layout" open={open.layout} onToggle={() => toggle('layout')}>
        <div className={cx(EYEBROW, 'mb-2')}>Display</div>
        <Segmented options={['Grid', 'Rows', 'Masonry']} value={display} onChange={setDisplay} full />

        <div className={cx(EYEBROW, 'mb-2 mt-4')}>Columns</div>
        <div className="flex items-center gap-2.5">
          <StepBtn name="minus" label="Fewer columns" onClick={() => setColumns((n) => Math.max(1, n - 1))} />
          <span className="min-w-5 text-center font-space text-[15px] font-bold">{columns}</span>
          <StepBtn name="plus" label="More columns" onClick={() => setColumns((n) => Math.min(4, n + 1))} />
          <span className="font-space text-[10px] uppercase tracking-[0.1em] text-ink-faint">across</span>
        </div>
      </Section>
    </>
  )
}

/* ── Text tools: edit the site's headings, taglines, bio, booking copy ───────── */
function TextTools({
  textFields,
  artistId,
  onApplyField,
}: {
  textFields: EditorTextField[]
  artistId: string
  onApplyField?: (key: string, value: string) => void
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(textFields.map((f) => [f.key, f.value])),
  )
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const saving = useRef<Map<string, Promise<unknown>>>(new Map())
  const errored = useRef<Set<string>>(new Set())
  const pending = useRef<Map<string, string>>(new Map())

  const persist = useCallback(
    (key: string, value: string) => {
      pending.current.delete(key)
      setStatus('saving')
      runSerialized(saving, errored, setStatus, key, () => saveEditorFieldAction(artistId, key, value))
    },
    [artistId],
  )

  // Flush any still-pending edits on unmount so a fast tab-away can't drop one.
  useEffect(() => {
    const timersMap = timers.current
    const pendingMap = pending.current
    return () => {
      timersMap.forEach((t) => clearTimeout(t))
      pendingMap.forEach((value, key) => {
        void saveEditorFieldAction(artistId, key, value)
      })
    }
  }, [artistId])

  function edit(field: EditorTextField, value: string) {
    setValues((v) => ({ ...v, [field.key]: value }))
    onApplyField?.(field.key, value) // optimistic live-preview paint
    pending.current.set(field.key, value)
    const existing = timers.current.get(field.key)
    if (existing) clearTimeout(existing)
    timers.current.set(
      field.key,
      setTimeout(() => {
        timers.current.delete(field.key)
        persist(field.key, value)
      }, 500),
    )
  }

  const control =
    'w-full rounded-lg border border-hairline px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-ink-faint'

  return (
    <div className="space-y-4 px-5 py-4">
      {textFields.map((f) => (
        <label key={f.key} className="block">
          <span className={cx(EYEBROW, 'mb-1.5 block')}>{f.label}</span>
          {f.multiline ? (
            <textarea
              value={values[f.key] ?? ''}
              onChange={(e) => edit(f, e.target.value)}
              className={cx(control, 'min-h-20 resize-y leading-relaxed')}
            />
          ) : (
            <input
              type={f.type === 'email' ? 'email' : 'text'}
              value={values[f.key] ?? ''}
              onChange={(e) => edit(f, e.target.value)}
              className={control}
            />
          )}
        </label>
      ))}
      {status !== 'idle' && (
        <div
          className={cx(
            'font-space text-[10px] uppercase tracking-[0.08em]',
            status === 'error' ? 'text-accent-red' : 'text-ink-faint',
          )}
        >
          {status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : 'Failed'}
        </div>
      )}
    </div>
  )
}

/* ── Link tools: edit / reorder / remove the site's outbound links ───────────── */
function LinkTools({
  links,
  artistId,
  onRemove,
  onReorder,
}: {
  links: EditorLink[]
  artistId: string
  onRemove: (l: EditorLink) => void
  onReorder: (from: number, to: number) => void
}) {
  const [values, setValues] = useState<Record<string, { label: string; url: string }>>(() =>
    Object.fromEntries(links.map((l) => [l.id, { label: l.label, url: l.url }])),
  )
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [invalid, setInvalid] = useState<Set<string>>(new Set())
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const saving = useRef<Map<string, Promise<unknown>>>(new Map())
  const errored = useRef<Set<string>>(new Set())
  const pending = useRef<Set<string>>(new Set())
  const dragFrom = useRef<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)
  // Latest values, so the unmount flush reads current text (synced off-render).
  const valuesRef = useRef(values)
  useEffect(() => {
    valuesRef.current = values
  }, [values])

  const persist = useCallback(
    (id: string, v: { label: string; url: string }) => {
      pending.current.delete(id)
      const fd = new FormData()
      fd.set('label', v.label)
      fd.set('url', v.url)
      setStatus('saving')
      runSerialized(saving, errored, setStatus, id, () => updateContentAction('link', id, artistId, fd))
    },
    [artistId],
  )

  useEffect(() => {
    const timersMap = timers.current
    const pendingSet = pending.current
    return () => {
      timersMap.forEach((t) => clearTimeout(t))
      pendingSet.forEach((id) => {
        const v = valuesRef.current[id]
        if (!v) return
        const fd = new FormData()
        fd.set('label', v.label)
        fd.set('url', v.url)
        void updateContentAction('link', id, artistId, fd)
      })
    }
  }, [artistId])

  function edit(id: string, patch: Partial<{ label: string; url: string }>) {
    const row = { ...(values[id] ?? { label: '', url: '' }), ...patch }
    setValues((v) => ({ ...v, [id]: { ...v[id], ...patch } }))
    const ok = row.label.trim() !== '' && row.url.trim() !== '' // both required — a blank one is dropped
    setInvalid((s) => {
      const n = new Set(s)
      if (ok) n.delete(id)
      else n.add(id)
      return n
    })
    const existing = timers.current.get(id)
    if (existing) clearTimeout(existing)
    timers.current.delete(id)
    if (!ok) {
      pending.current.delete(id)
      return
    }
    pending.current.add(id)
    timers.current.set(
      id,
      setTimeout(() => {
        timers.current.delete(id)
        persist(id, row)
      }, 500),
    )
  }

  function drop(to: number) {
    const from = dragFrom.current
    dragFrom.current = null
    setDragOver(null)
    if (from !== null && from !== to) onReorder(from, to)
  }

  return (
    <div className="space-y-2.5 px-5 py-4">
      {links.map((l, i) => (
        <div
          key={l.id}
          draggable
          onDragStart={() => (dragFrom.current = i)}
          onDragEnter={() => setDragOver(i)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => drop(i)}
          onDragEnd={() => {
            dragFrom.current = null
            setDragOver(null)
          }}
          className={cx(
            'flex items-start gap-2 rounded-lg border border-hairline p-2.5',
            dragOver === i && 'ring-2 ring-accent',
          )}
        >
          <span className="mt-1.5 flex-none cursor-grab text-ink-faint" aria-hidden>
            <Icon name="grip" size={16} />
          </span>
          <div className="min-w-0 flex-1 space-y-1.5">
            <input
              aria-label={`Link ${i + 1} label`}
              aria-invalid={(invalid.has(l.id) && !values[l.id]?.label.trim()) || undefined}
              value={values[l.id]?.label ?? ''}
              onChange={(e) => edit(l.id, { label: e.target.value })}
              placeholder="Label"
              className={cx(
                'w-full rounded-md border border-hairline px-2.5 py-1.5 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-ink-faint',
                invalid.has(l.id) && !values[l.id]?.label.trim() && INVALID_RING,
              )}
            />
            <input
              aria-label={`Link ${i + 1} URL`}
              aria-invalid={(invalid.has(l.id) && !values[l.id]?.url.trim()) || undefined}
              type="url"
              value={values[l.id]?.url ?? ''}
              onChange={(e) => edit(l.id, { url: e.target.value })}
              placeholder="https://…"
              className={cx(
                'w-full rounded-md border border-hairline px-2.5 py-1.5 font-space text-xs text-ink-muted outline-none placeholder:text-ink-faint focus:border-ink-faint',
                invalid.has(l.id) && !values[l.id]?.url.trim() && INVALID_RING,
              )}
            />
          </div>
          <button
            type="button"
            aria-label={`Remove link ${i + 1}`}
            onClick={() => onRemove(l)}
            className="mt-0.5 flex-none rounded-md p-1.5 text-ink-faint hover:bg-danger-soft hover:text-accent-red"
          >
            <Icon name="trash" size={15} />
          </button>
        </div>
      ))}

      <Link
        href={`/artists/${artistId}/links`}
        className="flex items-center justify-center gap-1.5 rounded-lg border-[1.5px] border-dashed border-hairline px-3 py-2.5 text-ink-muted hover:border-accent hover:text-accent"
      >
        <Icon name="plus" size={16} />
        <span className="font-space text-[10px] font-bold uppercase tracking-[0.08em]">Add link</span>
      </Link>

      {status !== 'idle' && (
        <div
          className={cx(
            'font-space text-[10px] uppercase tracking-[0.08em]',
            status === 'error' ? 'text-accent-red' : 'text-ink-faint',
          )}
        >
          {status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : 'Failed'}
        </div>
      )}
    </div>
  )
}

/* ── Video tools: edit title / reorder / remove the site's videos ────────────── */
function VideoTools({
  videos,
  artistId,
  onRemove,
  onReorder,
}: {
  videos: EditorVideo[]
  artistId: string
  onRemove: (v: EditorVideo) => void
  onReorder: (from: number, to: number) => void
}) {
  const [titles, setTitles] = useState<Record<string, string>>(() =>
    Object.fromEntries(videos.map((v) => [v.id, v.title])),
  )
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const saving = useRef<Map<string, Promise<unknown>>>(new Map())
  const errored = useRef<Set<string>>(new Set())
  const pending = useRef<Map<string, string>>(new Map())
  const dragFrom = useRef<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)

  const persist = useCallback(
    (id: string, title: string) => {
      pending.current.delete(id)
      setStatus('saving')
      runSerialized(saving, errored, setStatus, id, () => renameVideoAction(id, artistId, title))
    },
    [artistId],
  )

  useEffect(() => {
    const timersMap = timers.current
    const pendingMap = pending.current
    return () => {
      timersMap.forEach((t) => clearTimeout(t))
      pendingMap.forEach((title, id) => {
        void renameVideoAction(id, artistId, title)
      })
    }
  }, [artistId])

  function edit(id: string, title: string) {
    setTitles((t) => ({ ...t, [id]: title }))
    pending.current.set(id, title)
    const existing = timers.current.get(id)
    if (existing) clearTimeout(existing)
    timers.current.set(
      id,
      setTimeout(() => {
        timers.current.delete(id)
        persist(id, title)
      }, 500),
    )
  }

  function drop(to: number) {
    const from = dragFrom.current
    dragFrom.current = null
    setDragOver(null)
    if (from !== null && from !== to) onReorder(from, to)
  }

  return (
    <div className="space-y-2.5 px-5 py-4">
      {videos.map((v, i) => (
        <div
          key={v.id}
          draggable
          onDragStart={() => (dragFrom.current = i)}
          onDragEnter={() => setDragOver(i)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => drop(i)}
          onDragEnd={() => {
            dragFrom.current = null
            setDragOver(null)
          }}
          className={cx(
            'flex items-center gap-2.5 rounded-lg border border-hairline p-2',
            dragOver === i && 'ring-2 ring-accent',
          )}
        >
          <span className="flex-none cursor-grab text-ink-faint" aria-hidden>
            <Icon name="grip" size={16} />
          </span>
          <span className="flex h-11 w-16 flex-none items-center justify-center overflow-hidden rounded-md bg-track text-ink-faint">
            {v.poster ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={v.poster} alt="" className="h-full w-full object-cover" />
            ) : (
              <Icon name="videos" size={18} />
            )}
          </span>
          <input
            aria-label={`Video ${i + 1} title`}
            value={titles[v.id] ?? ''}
            onChange={(e) => edit(v.id, e.target.value)}
            placeholder="Title"
            className="min-w-0 flex-1 rounded-md border border-hairline px-2.5 py-1.5 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-ink-faint"
          />
          <button
            type="button"
            aria-label={`Remove video ${i + 1}`}
            onClick={() => onRemove(v)}
            className="flex-none rounded-md p-1.5 text-ink-faint hover:bg-danger-soft hover:text-accent-red"
          >
            <Icon name="trash" size={15} />
          </button>
        </div>
      ))}

      <Link
        href={`/artists/${artistId}/videos`}
        className="flex items-center justify-center gap-1.5 rounded-lg border-[1.5px] border-dashed border-hairline px-3 py-2.5 text-ink-muted hover:border-accent hover:text-accent"
      >
        <Icon name="plus" size={16} />
        <span className="font-space text-[10px] font-bold uppercase tracking-[0.08em]">Add video</span>
      </Link>

      {status !== 'idle' && (
        <div
          className={cx(
            'font-space text-[10px] uppercase tracking-[0.08em]',
            status === 'error' ? 'text-accent-red' : 'text-ink-faint',
          )}
        >
          {status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : 'Failed'}
        </div>
      )}
    </div>
  )
}

/* ── Merch tools: edit title / price / url, remove (no reorder — no sort_order) ─ */
function MerchTools({
  merch,
  artistId,
  onRemove,
}: {
  merch: EditorMerch[]
  artistId: string
  onRemove: (m: EditorMerch) => void
}) {
  type Fields = { title: string; price: string; url: string }
  const [values, setValues] = useState<Record<string, Fields>>(() =>
    Object.fromEntries(merch.map((m) => [m.id, { title: m.title, price: m.price, url: m.url }])),
  )
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [invalid, setInvalid] = useState<Set<string>>(new Set())
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const saving = useRef<Map<string, Promise<unknown>>>(new Map())
  const errored = useRef<Set<string>>(new Set())
  const pending = useRef<Set<string>>(new Set())
  const valuesRef = useRef(values)
  useEffect(() => {
    valuesRef.current = values
  }, [values])

  // Title is required; price must be blank or a number — else the write is dropped server-side.
  const badFields = (v: Fields) => ({
    title: v.title.trim() === '',
    price: v.price.trim() !== '' && Number.isNaN(Number(v.price)),
  })

  const persist = useCallback(
    (id: string, v: Fields) => {
      pending.current.delete(id)
      const fd = new FormData()
      fd.set('title', v.title)
      fd.set('price', v.price)
      fd.set('url', v.url)
      setStatus('saving')
      runSerialized(saving, errored, setStatus, id, () => updateContentAction('merch', id, artistId, fd))
    },
    [artistId],
  )

  useEffect(() => {
    const timersMap = timers.current
    const pendingSet = pending.current
    return () => {
      timersMap.forEach((t) => clearTimeout(t))
      pendingSet.forEach((id) => {
        const v = valuesRef.current[id]
        if (!v) return
        const fd = new FormData()
        fd.set('title', v.title)
        fd.set('price', v.price)
        fd.set('url', v.url)
        void updateContentAction('merch', id, artistId, fd)
      })
    }
  }, [artistId])

  function edit(id: string, patch: Partial<Fields>) {
    const row: Fields = { ...(values[id] ?? { title: '', price: '', url: '' }), ...patch }
    setValues((v) => ({ ...v, [id]: { ...v[id], ...patch } }))
    const bad = badFields(row)
    const ok = !bad.title && !bad.price
    setInvalid((s) => {
      const n = new Set(s)
      if (ok) n.delete(id)
      else n.add(id)
      return n
    })
    const existing = timers.current.get(id)
    if (existing) clearTimeout(existing)
    timers.current.delete(id)
    if (!ok) {
      pending.current.delete(id)
      return
    }
    pending.current.add(id)
    timers.current.set(
      id,
      setTimeout(() => {
        timers.current.delete(id)
        persist(id, row)
      }, 500),
    )
  }

  const control =
    'w-full rounded-md border border-hairline px-2.5 py-1.5 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-ink-faint'

  return (
    <div className="space-y-2.5 px-5 py-4">
      {merch.map((m, i) => (
        <div key={m.id} className="flex items-start gap-2.5 rounded-lg border border-hairline p-2.5">
          <span className="flex h-14 w-14 flex-none items-center justify-center overflow-hidden rounded-md bg-track text-ink-faint">
            {m.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={m.image_url} alt="" className="h-full w-full object-cover" />
            ) : (
              <Icon name="merch" size={18} />
            )}
          </span>
          <div className="min-w-0 flex-1 space-y-1.5">
            <input
              aria-label={`Product ${i + 1} name`}
              aria-invalid={(invalid.has(m.id) && !values[m.id]?.title.trim()) || undefined}
              value={values[m.id]?.title ?? ''}
              onChange={(e) => edit(m.id, { title: e.target.value })}
              placeholder="Item name"
              className={cx(control, invalid.has(m.id) && !values[m.id]?.title.trim() && INVALID_RING)}
            />
            <div className="flex gap-1.5">
              <input
                aria-label={`Product ${i + 1} price`}
                aria-invalid={
                  (invalid.has(m.id) && badFields(values[m.id] ?? { title: '', price: '', url: '' }).price) ||
                  undefined
                }
                value={values[m.id]?.price ?? ''}
                onChange={(e) => edit(m.id, { price: e.target.value })}
                placeholder="Price"
                inputMode="decimal"
                className={cx(
                  control,
                  'w-20 flex-none',
                  invalid.has(m.id) &&
                    badFields(values[m.id] ?? { title: '', price: '', url: '' }).price &&
                    INVALID_RING,
                )}
              />
              <input
                aria-label={`Product ${i + 1} URL`}
                type="url"
                value={values[m.id]?.url ?? ''}
                onChange={(e) => edit(m.id, { url: e.target.value })}
                placeholder="https://…"
                className={cx(control, 'min-w-0 flex-1 font-space text-xs text-ink-muted')}
              />
            </div>
          </div>
          <button
            type="button"
            aria-label={`Remove product ${i + 1}`}
            onClick={() => onRemove(m)}
            className="mt-0.5 flex-none rounded-md p-1.5 text-ink-faint hover:bg-danger-soft hover:text-accent-red"
          >
            <Icon name="trash" size={15} />
          </button>
        </div>
      ))}

      <Link
        href={`/artists/${artistId}/merch`}
        className="flex items-center justify-center gap-1.5 rounded-lg border-[1.5px] border-dashed border-hairline px-3 py-2.5 text-ink-muted hover:border-accent hover:text-accent"
      >
        <Icon name="plus" size={16} />
        <span className="font-space text-[10px] font-bold uppercase tracking-[0.08em]">Add product</span>
      </Link>

      {status !== 'idle' && (
        <div
          className={cx(
            'font-space text-[10px] uppercase tracking-[0.08em]',
            status === 'error' ? 'text-accent-red' : 'text-ink-faint',
          )}
        >
          {status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : 'Failed'}
        </div>
      )}
    </div>
  )
}

/* ── Music tools: edit song title / reorder / remove, with a Released tag ─────── */
function MusicTools({
  songs,
  artistId,
  onRemove,
  onReorder,
}: {
  songs: EditorSong[]
  artistId: string
  onRemove: (s: EditorSong) => void
  onReorder: (from: number, to: number) => void
}) {
  const [titles, setTitles] = useState<Record<string, string>>(() =>
    Object.fromEntries(songs.map((s) => [s.id, s.title])),
  )
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [invalid, setInvalid] = useState<Set<string>>(new Set())
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const saving = useRef<Map<string, Promise<unknown>>>(new Map())
  const errored = useRef<Set<string>>(new Set())
  const pending = useRef<Map<string, string>>(new Map())
  const dragFrom = useRef<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)

  const persist = useCallback(
    (id: string, title: string) => {
      pending.current.delete(id)
      const fd = new FormData()
      fd.set('title', title)
      setStatus('saving')
      runSerialized(saving, errored, setStatus, id, () => updateContentAction('track', id, artistId, fd))
    },
    [artistId],
  )

  useEffect(() => {
    const timersMap = timers.current
    const pendingMap = pending.current
    return () => {
      timersMap.forEach((t) => clearTimeout(t))
      pendingMap.forEach((title, id) => {
        const fd = new FormData()
        fd.set('title', title)
        void updateContentAction('track', id, artistId, fd)
      })
    }
  }, [artistId])

  function edit(id: string, title: string) {
    setTitles((t) => ({ ...t, [id]: title }))
    const ok = title.trim() !== '' // title is required — a blank one is dropped server-side
    setInvalid((s) => {
      const n = new Set(s)
      if (ok) n.delete(id)
      else n.add(id)
      return n
    })
    const existing = timers.current.get(id)
    if (existing) clearTimeout(existing)
    timers.current.delete(id)
    if (!ok) {
      pending.current.delete(id) // don't save (or flush on unmount) an invalid value
      return
    }
    pending.current.set(id, title)
    timers.current.set(
      id,
      setTimeout(() => {
        timers.current.delete(id)
        persist(id, title)
      }, 500),
    )
  }

  function drop(to: number) {
    const from = dragFrom.current
    dragFrom.current = null
    setDragOver(null)
    if (from !== null && from !== to) onReorder(from, to)
  }

  return (
    <div className="space-y-2.5 px-5 py-4">
      {songs.map((s, i) => (
        <div
          key={s.id}
          draggable
          onDragStart={() => (dragFrom.current = i)}
          onDragEnter={() => setDragOver(i)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => drop(i)}
          onDragEnd={() => {
            dragFrom.current = null
            setDragOver(null)
          }}
          className={cx(
            'flex items-center gap-2.5 rounded-lg border border-hairline p-2',
            dragOver === i && 'ring-2 ring-accent',
          )}
        >
          <span className="flex-none cursor-grab text-ink-faint" aria-hidden>
            <Icon name="grip" size={16} />
          </span>
          <span className="flex h-11 w-11 flex-none items-center justify-center overflow-hidden rounded-md bg-track text-ink-faint">
            {s.cover_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={s.cover_url} alt="" className="h-full w-full object-cover" />
            ) : (
              <Icon name="tracks" size={18} />
            )}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <input
              aria-label={`Song ${i + 1} title`}
              aria-invalid={invalid.has(s.id) || undefined}
              value={titles[s.id] ?? ''}
              onChange={(e) => edit(s.id, e.target.value)}
              placeholder="Title"
              className={cx(
                'w-full rounded-md border border-hairline px-2.5 py-1.5 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-ink-faint',
                invalid.has(s.id) && INVALID_RING,
              )}
            />
            <span
              className={cx(
                'w-fit rounded-full px-2 py-0.5 font-space text-[9px] font-bold uppercase tracking-[0.1em]',
                s.released ? 'bg-accent-soft text-accent' : 'bg-track text-ink-faint',
              )}
            >
              {s.released ? 'Released' : 'Unreleased'}
            </span>
          </div>
          <button
            type="button"
            aria-label={`Remove song ${i + 1}`}
            onClick={() => onRemove(s)}
            className="flex-none rounded-md p-1.5 text-ink-faint hover:bg-danger-soft hover:text-accent-red"
          >
            <Icon name="trash" size={15} />
          </button>
        </div>
      ))}

      <Link
        href={`/artists/${artistId}/music`}
        className="flex items-center justify-center gap-1.5 rounded-lg border-[1.5px] border-dashed border-hairline px-3 py-2.5 text-ink-muted hover:border-accent hover:text-accent"
      >
        <Icon name="plus" size={16} />
        <span className="font-space text-[10px] font-bold uppercase tracking-[0.08em]">Add song</span>
      </Link>

      {status !== 'idle' && (
        <div
          className={cx(
            'font-space text-[10px] uppercase tracking-[0.08em]',
            status === 'error' ? 'text-accent-red' : 'text-ink-faint',
          )}
        >
          {status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : 'Failed'}
        </div>
      )}
    </div>
  )
}

/* ── Small building blocks ───────────────────────────────────────────────────── */
function Section({
  title,
  open,
  onToggle,
  extra,
  children,
}: {
  title: string
  open: boolean
  onToggle: () => void
  extra?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-5 pb-2.5 pt-4"
      >
        <span className={EYEBROW}>{title}</span>
        <span className="flex items-center gap-2">
          {extra}
          <Icon
            name="chevronRight"
            size={16}
            className={cx('text-ink-faint transition-transform', open && 'rotate-90')}
          />
        </span>
      </button>
      {open && <div className="border-b border-hairline-soft px-5 pb-4 pt-0.5">{children}</div>}
    </div>
  )
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-track px-2 py-0.5 font-space text-[10px] font-bold text-ink-faint">
      {children}
    </span>
  )
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
  full,
}: {
  options: readonly T[]
  value: T
  onChange: (v: T) => void
  full?: boolean
}) {
  return (
    <div className={cx('inline-flex gap-0.5 rounded-[9px] border border-hairline p-0.5', full && 'w-full')}>
      {options.map((o) => (
        <button
          key={o}
          type="button"
          aria-pressed={o === value}
          onClick={() => onChange(o)}
          className={cx(
            'flex-1 rounded-[7px] px-3 py-1.5 text-xs font-semibold transition-colors',
            o === value ? 'bg-ink text-white' : 'text-ink-muted hover:text-ink',
          )}
        >
          {o}
        </button>
      ))}
    </div>
  )
}

function StepBtn({ name, label, onClick }: { name: IconName; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-lg border border-hairline text-ink-muted hover:border-ink-faint hover:text-ink"
    >
      <Icon name={name} size={16} />
    </button>
  )
}
