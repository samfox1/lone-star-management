'use client'

import { useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { cx } from '@/lib/cx'
import { mediaUrl } from '@/lib/site'
import { reorderList } from '@/lib/site-editor/gallery'
import { Icon, type IconName } from '@/components/ui/icons'
import { deleteMediaAction, reorderGalleryAction } from '../actions'

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

type Kind = 'images' | 'text' | 'links' | 'videos' | 'music' | 'merch'
type Component = { kind: Kind; icon: IconName; label: string; caption: string }

const COMPONENTS: Component[] = [
  { kind: 'images', icon: 'photo', label: 'Images', caption: 'Photo gallery' },
  { kind: 'text', icon: 'text', label: 'Text', caption: '8 text blocks' },
  { kind: 'links', icon: 'links', label: 'Links', caption: '5 links' },
  { kind: 'videos', icon: 'videos', label: 'Videos', caption: '6 videos' },
  { kind: 'music', icon: 'tracks', label: 'Music', caption: '1 album · 9 songs' },
  { kind: 'merch', icon: 'merch', label: 'Merch', caption: '4 products' },
]

const EYEBROW = 'font-space text-[10px] font-bold uppercase tracking-[0.12em] text-ink-faint'

function photoCount(n: number) {
  return `${n} ${n === 1 ? 'photo' : 'photos'}`
}

export function EditorInspector({ artistId, photos: initial }: { artistId: string; photos: GalleryPhoto[] }) {
  const [active, setActive] = useState<Component | null>(null)
  const [photos, setPhotos] = useState<GalleryPhoto[]>(initial)
  const [, startTransition] = useTransition()

  function removePhoto(p: GalleryPhoto) {
    const prev = photos
    setPhotos((list) => list.filter((x) => x.id !== p.id)) // optimistic
    startTransition(async () => {
      const res = await deleteMediaAction(p.id, p.storage_path, artistId)
      if (res?.error) setPhotos(prev) // revert on failure
    })
  }

  function reorderPhotos(from: number, to: number) {
    const prev = photos
    const next = reorderList(photos, from, to)
    setPhotos(next) // optimistic
    startTransition(async () => {
      const res = await reorderGalleryAction(artistId, next.map((p) => p.id))
      if (res?.error) setPhotos(prev) // revert on failure
    })
  }

  return (
    <aside className="flex w-[344px] flex-none flex-col overflow-hidden border-r border-hairline bg-paper">
      {active ? (
        <EditingView
          component={active}
          photos={photos}
          artistId={artistId}
          onRemove={removePhoto}
          onReorder={reorderPhotos}
          onBack={() => setActive(null)}
          onSwitch={setActive}
        />
      ) : (
        <BrowseView imageCount={photos.length} onOpen={setActive} />
      )}
    </aside>
  )
}

/* ── Browse: the component-type list ─────────────────────────────────────────── */
function BrowseView({ imageCount, onOpen }: { imageCount: number; onOpen: (c: Component) => void }) {
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
                {c.kind === 'images' ? photoCount(imageCount) : c.caption}
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
  artistId,
  onRemove,
  onReorder,
  onBack,
  onSwitch,
}: {
  component: Component
  photos: GalleryPhoto[]
  artistId: string
  onRemove: (p: GalleryPhoto) => void
  onReorder: (from: number, to: number) => void
  onBack: () => void
  onSwitch: (c: Component) => void
}) {
  const isImages = component.kind === 'images'
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
          <span className={EYEBROW}>{isImages ? photoCount(photos.length) : component.caption}</span>
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isImages ? (
          <PhotoTools photos={photos} artistId={artistId} onRemove={onRemove} onReorder={onReorder} />
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
}: {
  photos: GalleryPhoto[]
  artistId: string
  onRemove: (p: GalleryPhoto) => void
  onReorder: (from: number, to: number) => void
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
          <Link
            href={`/artists/${artistId}/images`}
            className="flex aspect-[4/3] flex-col items-center justify-center gap-1.5 rounded-lg border-[1.5px] border-dashed border-hairline text-ink-muted hover:border-accent hover:text-accent"
          >
            <Icon name="plus" size={18} />
            <span className="font-space text-[10px] font-bold uppercase tracking-[0.08em]">Add photos</span>
          </Link>
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
