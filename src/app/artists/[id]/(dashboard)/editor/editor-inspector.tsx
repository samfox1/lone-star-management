'use client'

import { useState } from 'react'
import { cx } from '@/lib/cx'
import { Icon, type IconName } from '@/components/ui/icons'

/**
 * The visual editor's LEFT inspector (SITE_EDITOR_PLAN.md phase 2 — panel redesign).
 * Two states: BROWSE (a breathable list of the site's component types) and EDITING
 * (the tools for the selected component, with the browse list collapsed to an icon
 * strip at the bottom). This lands the panel's structure + navigation; the tools
 * render against placeholder collection data and are wired to real photo-collection
 * data + saves in the next step.
 */

type Kind = 'images' | 'text' | 'links' | 'videos' | 'music' | 'merch'
type Component = { kind: Kind; icon: IconName; label: string; caption: string }

const COMPONENTS: Component[] = [
  { kind: 'images', icon: 'photo', label: 'Images', caption: '3 collections · 24 photos' },
  { kind: 'text', icon: 'text', label: 'Text', caption: '8 text blocks' },
  { kind: 'links', icon: 'links', label: 'Links', caption: '5 links' },
  { kind: 'videos', icon: 'videos', label: 'Videos', caption: '6 videos' },
  { kind: 'music', icon: 'tracks', label: 'Music', caption: '1 album · 9 songs' },
  { kind: 'merch', icon: 'merch', label: 'Merch', caption: '4 products' },
]

// Placeholder collection — real data lands with the wiring step.
const PHOTOS = [
  { id: 'p1', name: 'backstage-03.jpg', bg: 'linear-gradient(135deg,#3a3a3f,#0f0f12)' },
  { id: 'p2', name: 'soundcheck.jpg', bg: 'linear-gradient(135deg,#5b4636,#171008)' },
  { id: 'p3', name: 'crowd-01.jpg', bg: 'linear-gradient(135deg,#2f3d4a,#0c1116)' },
  { id: 'p4', name: 'neon-gate.jpg', bg: 'linear-gradient(135deg,#4a2f3d,#160a10)' },
  { id: 'p5', name: 'tour-van.jpg', bg: 'linear-gradient(135deg,#33413a,#0a120d)' },
  { id: 'p6', name: 'encore.jpg', bg: 'linear-gradient(135deg,#45414d,#121016)' },
]

const EYEBROW = 'font-space text-[10px] font-bold uppercase tracking-[0.12em] text-ink-faint'

export function EditorInspector() {
  const [active, setActive] = useState<Component | null>(null)

  return (
    <aside className="flex w-[344px] flex-none flex-col overflow-hidden border-r border-hairline bg-paper">
      {active ? (
        <EditingView component={active} onBack={() => setActive(null)} onSwitch={setActive} />
      ) : (
        <BrowseView onOpen={setActive} />
      )}
    </aside>
  )
}

/* ── Browse: the component-type list ─────────────────────────────────────────── */
function BrowseView({ onOpen }: { onOpen: (c: Component) => void }) {
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
              <span className="font-space text-[10px] tracking-[0.04em] text-ink-faint">{c.caption}</span>
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
  onBack,
  onSwitch,
}: {
  component: Component
  onBack: () => void
  onSwitch: (c: Component) => void
}) {
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
          <span className="text-base font-semibold">
            {component.kind === 'images' ? 'Live Shots' : component.label}
          </span>
          <span className={EYEBROW}>
            {component.kind === 'images' ? '12 photos · Grid' : component.caption}
          </span>
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {component.kind === 'images' ? (
          <PhotoTools />
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
function PhotoTools() {
  const [open, setOpen] = useState({ photos: true, sizing: true, layout: true })
  const [perImage, setPerImage] = useState<'S' | 'M' | 'L'>('M')
  const [display, setDisplay] = useState<'Grid' | 'Rows' | 'Masonry'>('Grid')
  const [columns, setColumns] = useState(2)
  const [size, setSize] = useState(55)
  const toggle = (k: keyof typeof open) => setOpen((o) => ({ ...o, [k]: !o[k] }))

  return (
    <>
      <Section title="Photos" open={open.photos} onToggle={() => toggle('photos')} extra={<Pill>{PHOTOS.length}</Pill>}>
        <div className="grid grid-cols-2 gap-2.5">
          {PHOTOS.map((p) => (
            <div key={p.id} className="group relative overflow-hidden rounded-lg">
              <div className="aspect-[4/3] w-full rounded-lg" style={{ background: p.bg }} />
              <span className="absolute left-1.5 top-1.5 hidden cursor-grab rounded-md bg-black/35 p-0.5 text-white group-hover:flex">
                <Icon name="grip" size={16} />
              </span>
              <button
                type="button"
                aria-label={`Remove ${p.name}`}
                className="absolute right-1.5 top-1.5 hidden rounded-md bg-black/35 p-1 text-white hover:bg-accent-red group-hover:flex"
              >
                <Icon name="trash" size={14} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="flex aspect-[4/3] flex-col items-center justify-center gap-1.5 rounded-lg border-[1.5px] border-dashed border-hairline text-ink-muted hover:border-accent hover:text-accent"
          >
            <Icon name="plus" size={18} />
            <span className="font-space text-[10px] font-bold uppercase tracking-[0.08em]">Add photos</span>
          </button>
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
          <div className="h-10 w-[52px] flex-none rounded-md" style={{ background: PHOTOS[0].bg }} />
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
