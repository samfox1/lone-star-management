import { useState, useEffect, useRef, useMemo } from 'react'
import { cx } from '@/lib/cx'
import { ColorPalette } from '../color-picker'
import { Icon } from '@/components/ui/icons'
import { groupStyleRegions, sectionRowLabel, visibleStyleRegions, type ManifestStyleRegion } from '@/lib/site-editor/manifest'
import {
  applyStyleValue,
  sameClasses,
  buildStyleControls,
  controlsForRegion,
  readStyleValue,
  type SiteStyleOptions,
  type StyleControl, sliderSteps, sliderIndex } from '@/lib/site-editor/style-controls'
import {
  EditRow,
  ControlRow,
  SaveLine,
  GroupLabel,
  PANEL_BODY,
  CONTROL_LABEL,
} from '../inspector-shared'
import { useStyleRegionSave } from '../use-style-save'
import { siteSwatches } from '@/lib/site-editor/style-apply'

/** One friendly control row (a labelled dropdown or a toggle) for a style region — reused
 *  by the per-item editor. `regionLabel` prefixes every aria label ("Hero title Size"). */
export function StyleControlRow({
  regionLabel,
  control,
  cls,
  onChange,
  swatches,
}: {
  regionLabel: string
  control: StyleControl
  cls: string
  onChange: (value: string) => void
  /** Site palette + already-used colours, for generic colour controls' swatch row. */
  swatches?: string[]
}) {
  const current = readStyleValue(control, cls)
  const aria = `${regionLabel} ${control.label}`
  if (control.kind === 'toggle') {
    return (
      <ControlRow label={control.label}>
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
  if (control.kind === 'slider') {
    // THE DEFAULT IS NOT A STEP ON THE SCALE.
    //
    // It used to be steps[0], which put "whatever the site already uses" at the far LEFT
    // of an otherwise ascending run. That made the slider non-monotonic and, for any
    // region whose own size is large, actively backwards: skeen's hero wordmark is
    // text-[clamp(4rem,18vw,11rem)], so the handle started at the left showing that, and
    // the first nudge RIGHT jumped to text-sm. Sam reported it as "I move them to the
    // right and they get smaller", which is exactly what it did.
    //
    // The scale is now only real values, low → high. An untouched control sits in the
    // MIDDLE and reads "Default": mid-scale is honest about "unset" in a way that either
    // end is not, and it leaves room to drag both ways. Clearing is an explicit button
    // rather than a hidden position at one end.
    // ...and a value the site set itself is almost never one of OUR steps. skeen's hero is
    // text-[clamp(4rem,18vw,11rem)] — above every step here — so it fell through to the
    // resting position too, and one notch right dropped it to 2.25rem. sliderIndex now
    // MEASURES an off-scale value and parks the handle at the nearest step, so dragging
    // right is always a little bigger than what is on screen. Only a value it cannot
    // resolve to a number rests in the middle.
    const steps = sliderSteps(control)
    const canReset = steps.length !== control.steps.length
    const { idx, label, exact } = sliderIndex(control, current)
    return (
      <div className="py-1">
        <div className="flex items-center justify-between">
          <span className={CONTROL_LABEL}>{control.label}</span>
          <span className="flex items-center gap-2">
            <span className="font-space text-[11px] text-ink-muted">{label}</span>
            {canReset && exact && (
              <button
                type="button"
                onClick={() => onChange('')}
                className="font-space text-[11px] text-ink-muted underline underline-offset-2 hover:text-ink"
              >
                Reset
              </button>
            )}
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={steps.length - 1}
          value={idx}
          aria-label={aria}
          onChange={(e) => onChange(steps[Number(e.target.value)].value)}
          className="lse-slider mt-1 w-full"
        />
      </div>
    )
  }
  // A GENERIC colour control (one that knows how to read and write its own token —
  // the gradient ends) renders a palette right here. The plain border-colour control
  // stays the item editor's special case, exactly as before.
  if (control.kind === 'color') {
    if (!control.hexOf || !control.toToken) return null
    return (
      <ControlRow label={control.label}>
        <ColorPalette
          label=""
          aria={aria}
          value={control.hexOf(cls)}
          used={swatches ?? []}
          onChange={(hex) => onChange(control.toToken!(hex, cls))}
        />
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
    <ControlRow label={control.label}>
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
  const [open, setOpen] = useState<string | null>(null)
  const rowRefs = useRef<Map<string, HTMLElement | null>>(new Map())
  const { status, save } = useStyleRegionSave(artistId, onApplyStyle)

  const controls = useMemo(() => buildStyleControls(options), [options])

  // The frame's edit-list arrives asynchronously (on `ready`), so regions/values can
  // land after first render — re-seed when they do, without clobbering typing.
  const seedKey = regions.map((r) => r.key).join(',')
  const [seeded, setSeeded] = useState(seedKey)
  if (seeded !== seedKey) {
    setSeeded(seedKey)
    setText(Object.fromEntries(regions.map((r) => [r.key, values[r.key] ?? r.base ?? ''])))
  }

  // Clicking a styled region in the frame opens its accordion row (during-render reset,
  // same sanctioned pattern as the panel switch above). The null reset matters: the
  // inspector CLEARS `selected` on manual tab navigation, and without forgetting the
  // old key here a re-click of the same element would never re-open its row.
  const [lastSel, setLastSel] = useState<string | null>(null)
  if (selected && selected !== lastSel) {
    setLastSel(selected)
    setOpen(selected)
  }
  if (!selected && lastSel) setLastSel(null)

  // Two modes, never mixed (visibleStyleRegions): a click shows ONLY that region's
  // controls; browsing lists ONLY site-wide regions. Note `text` still seeds from ALL
  // regions: a click must find its value already loaded.
  const groupedRegions = useMemo(
    () => groupStyleRegions(visibleStyleRegions(regions, selected)),
    [regions, selected],
  )
  useEffect(() => {
    if (!open) return
    rowRefs.current.get(open)?.scrollIntoView?.({ block: 'center' })
  }, [open])

  /** Two class strings that mean the same styling — same tokens, any order. Order only
   *  breaks ties within equal specificity, which the controls never produce. */
  function edit(key: string, raw: string, base: string) {
    setText((t) => ({ ...t, [key]: raw }))
    // A string that equals the region's BASE is not an override — save '' so the row is
    // DELETED rather than pinning a copy of the defaults (skeen brief, 2026-08-03: a
    // pinned copy wins forever over any later change to the site's own base classes).
    const toSave = sameClasses(raw, base) ? '' : raw
    // The hook validates with the SAME function the server uses, so the panel can't
    // claim "Saved" on a rejected write. Controls always emit clean utilities; only a
    // raw escape hatch could produce something invalid.
    const ok = save(key, toSave)
    setInvalid((s) => {
      const next = new Set(s)
      if (ok) next.delete(key)
      else next.add(key)
      return next
    })
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
      {/* No instruction line (Sam, 2026-08-12: "the goal is for the ui to be easy
          enough to not need them") — the browse list holds only site-wide styles;
          clicking the preview is discoverable on its own. */}
      {/* Regions are grouped by their manifest `group` ("Hero", "Sections", …) so the
          panel reads as a short outline of the page rather than one long list. Regions
          with no group fall under a single unlabelled run, preserving manifest order. */}
      {groupedRegions.map(([group, rows]) => {
        // Suppress a heading that a single row would only repeat — "Footer" over a
        // "Footer" row is one double header (Sam, 2026-08-12). With >1 row the heading
        // earns its place and each row drops the heading word instead.
        const showHeading = Boolean(group) && !(rows.length === 1 && sectionRowLabel(group, rows[0].label) === '')
        // A suppressed heading must still BREAK from the group above: without the
        // boundary, the bare "Footer" row reads as a child of "Hero" (Sam, 2026-08-14:
        // "the footer should be its own thing"). Same rhythm as GroupLabel, no text.
        const showRule = Boolean(group) && !showHeading
        return (
        <div key={group || '_'}>
          {showHeading && <GroupLabel>{group}</GroupLabel>}
          {showRule && (
            <div role="separator" className="px-5 pb-1 pt-4">
              <span className="block h-px bg-hairline-soft" />
            </div>
          )}
          {rows.map((r) => {
            const cls = text[r.key] ?? ''
            const isOpen = open === r.key
            const rowLabel = showHeading ? sectionRowLabel(group, r.label) || r.label : r.label
            return (
              <div
                key={r.key}
                ref={(el) => {
                  rowRefs.current.set(r.key, el)
                }}
              >
                {/* Version-A row: just the region name, a hover pencil (Sam,
                    2026-08-12 — no "Paper · 2px" value line). The pencil reveals the
                    controls inline below, the same as the Links rows. */}
                <EditRow label={rowLabel} onEdit={() => setOpen(isOpen ? null : r.key)} />
                {isOpen && (
                  <div className={PANEL_BODY}>
                    {/* Site-wide regions get SURFACE controls only (controlsForRegion):
                        text styling on the page itself is noise. Every colour picker
                        gets the colours-on-site swatch row — the one format. */}
                    {controlsForRegion(controls, r).map((control) => (
                      <StyleControlRow
                        key={control.id}
                        regionLabel={r.label}
                        control={control}
                        cls={cls}
                        swatches={siteSwatches(options, values)}
                        onChange={(v) => edit(r.key, applyStyleValue(cls, control, v), r.base ?? '')}
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
        )
      })}
      <SaveLine status={status} />
    </div>
  )
}
