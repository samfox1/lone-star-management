import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { cx } from '@/lib/cx'
import { Icon, type IconName } from '@/components/ui/icons'
import { groupStyleRegions, type ManifestStyleRegion } from '@/lib/site-editor/manifest'
import { cleanClassText } from '@/lib/site-editor/save'
import {
  applyStyleValue,
  buildStyleControls,
  readStyleValue,
  type SiteStyleOptions,
  type StyleControl,
} from '@/lib/site-editor/style-controls'
import {
  runSerialized,
  SectionRow,
  ControlRow,
  SaveLine,
  GroupLabel,
  PANEL_BODY,
  type SaveStatus,
} from '../inspector-shared'
import { saveEditorStyleAction } from '../../actions'

const STYLE_CONTROL_ICON: Record<string, IconName> = {
  font: 'text',
  size: 'fontSize',
  weight: 'bold',
  textColor: 'palette',
  bgColor: 'fill',
  align: 'align',
  uppercase: 'uppercase',
  italic: 'italic',
}
/** One friendly control row (a labelled dropdown or a toggle) for a style region. */
function StyleControlRow({
  region,
  control,
  cls,
  onChange,
}: {
  region: ManifestStyleRegion
  control: StyleControl
  cls: string
  onChange: (value: string) => void
}) {
  const current = readStyleValue(control, cls)
  const aria = `${region.label} ${control.label}`
  const icon = STYLE_CONTROL_ICON[control.id] ?? 'tools'
  if (control.kind === 'toggle') {
    return (
      <ControlRow icon={icon} label={control.label}>
        {/* A switch, not a checkbox: it reads as on/off at a glance in a panel where
            every other control is a value, and it matches OnSiteToggle elsewhere. */}
        <button
          type="button"
          role="switch"
          aria-checked={current === 'on'}
          aria-label={aria}
          onClick={() => onChange(current === 'on' ? '' : 'on')}
          className={cx(
            'relative h-5 w-9 flex-none rounded-full transition-colors',
            current === 'on' ? 'bg-ink' : 'bg-hairline',
          )}
        >
          <span
            className={cx(
              'absolute top-0.5 h-4 w-4 rounded-full bg-paper shadow-sm transition-[left]',
              current === 'on' ? 'left-[18px]' : 'left-0.5',
            )}
          />
        </button>
      </ControlRow>
    )
  }
  // Show the current value even when it's a class the site declared no option for (e.g. a
  // base class), so nothing is silently dropped or mislabelled as Default.
  const options =
    current && !control.options.some((o) => o.value === current)
      ? [{ value: current, label: current }, ...control.options]
      : control.options
  const currentLabel = options.find((o) => o.value === current)?.label ?? options[0]?.label ?? ''
  return (
    <ControlRow icon={icon} label={control.label}>
      {/* The <select> stays for BEHAVIOUR (native menu, keyboard, a11y, and the `.value`
          every test drives) but is transparent and stretched over the row; the value is
          painted beside it as ordinary DOM text. macOS Chrome renders a control's own
          text in the system font no matter what `font-family` computes to, so the only
          way to get Inter here is to not let the control draw it. */}
      <span className="relative inline-flex flex-none items-center">
        <select
          aria-label={aria}
          value={current}
          onChange={(e) => onChange(e.target.value)}
          className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0 outline-none"
        >
          {options.map((o) => (
            <option key={o.value || 'default'} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <span className="pointer-events-none inline-flex items-center gap-1 rounded-md px-1.5 py-1 peer-hover:bg-paper peer-focus:bg-paper peer-focus-visible:ring-1 peer-focus-visible:ring-ink-faint">
          <span className="font-space text-[13px] text-ink">{currentLabel}</span>
          <span className="rotate-90 text-ink-faint" aria-hidden>
            <Icon name="chevronRight" size={13} />
          </span>
        </span>
      </span>
    </ControlRow>
  )
}

/* ── Style tools: NO-CODE styling (SITE_STYLING_PLAN.md) ─────────────────────────────
 * Each region is an accordion row; open one to get friendly controls (size, boldness,
 * font, colour, alignment, uppercase, italic) instead of a raw class string. A control
 * OWNS a slice of the region's Tailwind class string (lib/style-controls) — changing it
 * swaps that utility and PRESERVES the rest. The raw string is still reachable under
 * "Advanced" for anything the controls don't cover. Same debounced save + optimistic
 * frame repaint as before; the underlying store (site_styles.class_names) is unchanged. */
export function StyleTools({
  regions,
  values,
  options,
  selected,
  artistId,
  onApplyStyle,
}: {
  regions: ManifestStyleRegion[]
  values: Record<string, string>
  options?: SiteStyleOptions
  selected: string | null
  artistId: string
  onApplyStyle?: (key: string, className: string) => void
}) {
  // Seed each region with its saved override if there is one, else its BASE classes — so
  // the controls read what's actually on the element. A stored string REPLACES the base.
  const [text, setText] = useState<Record<string, string>>(() =>
    Object.fromEntries(regions.map((r) => [r.key, values[r.key] ?? r.base ?? ''])),
  )
  const [invalid, setInvalid] = useState<Set<string>>(new Set())
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [open, setOpen] = useState<string | null>(null)
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const saving = useRef<Map<string, Promise<unknown>>>(new Map())
  const errored = useRef<Set<string>>(new Set())
  const pending = useRef<Map<string, string>>(new Map())
  const rowRefs = useRef<Map<string, HTMLElement | null>>(new Map())

  const controls = useMemo(() => buildStyleControls(options), [options])
  const groupedRegions = useMemo(() => groupStyleRegions(regions), [regions])

  // The frame's edit-list arrives asynchronously (on `ready`), so regions/values can
  // land after first render — re-seed when they do, without clobbering typing.
  const seedKey = regions.map((r) => r.key).join(',')
  const [seeded, setSeeded] = useState(seedKey)
  if (seeded !== seedKey) {
    setSeeded(seedKey)
    setText(Object.fromEntries(regions.map((r) => [r.key, values[r.key] ?? r.base ?? ''])))
  }

  // Clicking a styled region in the frame opens its accordion row (during-render reset,
  // same sanctioned pattern as the panel switch above).
  const [lastSel, setLastSel] = useState<string | null>(null)
  if (selected && selected !== lastSel) {
    setLastSel(selected)
    setOpen(selected)
  }
  useEffect(() => {
    if (!open) return
    rowRefs.current.get(open)?.scrollIntoView?.({ block: 'center' })
  }, [open])

  const persist = useCallback(
    (key: string, className: string) => {
      pending.current.delete(key)
      setStatus('saving')
      runSerialized(saving, errored, setStatus, key, () => saveEditorStyleAction(artistId, key, className))
    },
    [artistId],
  )

  // Flush pending edits on unmount so tabbing away can't drop the last change.
  useEffect(() => {
    const timersMap = timers.current
    const pendingMap = pending.current
    return () => {
      timersMap.forEach((t) => clearTimeout(t))
      pendingMap.forEach((className, key) => {
        void saveEditorStyleAction(artistId, key, className)
      })
    }
  }, [artistId])

  function edit(key: string, raw: string) {
    setText((t) => ({ ...t, [key]: raw }))
    // Validate with the SAME function the server uses, so the panel can't claim "Saved"
    // on a rejected write. Controls always emit clean utilities; only the Advanced raw
    // box can produce something invalid.
    const clean = cleanClassText(raw)
    setInvalid((s) => {
      const next = new Set(s)
      if (clean === null) next.add(key)
      else next.delete(key)
      return next
    })
    if (clean === null) return

    onApplyStyle?.(key, clean) // optimistic repaint in the frame
    pending.current.set(key, clean)
    const existing = timers.current.get(key)
    if (existing) clearTimeout(existing)
    timers.current.set(
      key,
      setTimeout(() => {
        timers.current.delete(key)
        persist(key, clean)
      }, 500),
    )
  }

  if (!regions.length) {
    return (
      <p className="px-5 py-6 text-sm leading-relaxed text-ink-muted">
        This site hasn&apos;t declared any styleable sections. A custom site sends its own
        edit-list when the preview loads; the built-in templates don&apos;t tag sections yet.
      </p>
    )
  }

  return (
    <div className="py-2">
      {/* Regions are grouped by their manifest `group` ("Hero", "Sections", …) so the
          panel reads as a short outline of the page rather than one long list. Regions
          with no group fall under a single unlabelled run, preserving manifest order. */}
      {groupedRegions.map(([group, rows]) => (
        <div key={group || '_'}>
          {group && <GroupLabel>{group}</GroupLabel>}
          {rows.map((r) => {
            const cls = text[r.key] ?? ''
            const isOpen = open === r.key
            return (
              <div
                key={r.key}
                ref={(el) => {
                  rowRefs.current.set(r.key, el)
                }}
              >
                <SectionRow
                  label={r.label}
                  open={isOpen}
                  onClick={() => setOpen(isOpen ? null : r.key)}
                />
                {isOpen && (
                  <div className={PANEL_BODY}>
                    {controls.map((control) => (
                      <StyleControlRow
                        key={control.id}
                        region={r}
                        control={control}
                        cls={cls}
                        onChange={(v) => edit(r.key, applyStyleValue(cls, control, v))}
                      />
                    ))}
                    {/* No raw-class escape hatch: this panel is for a MANAGER, and a
                        Tailwind class string is not something they can reason about
                        (Sam, 2026-07-21). The controls above own every utility they
                        understand; anything else in the region's base classes is
                        preserved untouched by applyStyleValue, just not editable here.
                        The validation below stays as a backstop so a bad value can
                        never be reported as "Saved". */}
                    {invalid.has(r.key) && (
                      <p className="pt-1 text-[11px] text-accent-red">
                        Not saved — that setting produced something the site can&apos;t use.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ))}
      <SaveLine status={status} />
    </div>
  )
}
