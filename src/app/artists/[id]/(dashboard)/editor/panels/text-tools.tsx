import { groupByPrefix, sectionRowLabel } from '@/lib/site-editor/manifest'
import { type EditorTextField } from '../inspector-types'
import { GroupLabel, SaveLine, EditRow, type SaveStatus } from '../inspector-shared'

/* ── Text tools: the site's headings, taglines, bio, booking copy ──────────────
 *
 * A READ-ONLY list. Editing happens in the full-panel editor behind Edit, exactly like
 * an image or a video slot — one place a field is changed, so there is no question of
 * which of two inputs is authoritative, and no way to alter the live site by brushing
 * past a textarea while scrolling the panel.
 */
export function TextTools({
  textFields,
  values,
  status,
  onEditField,
}: {
  textFields: EditorTextField[]
  values: Record<string, string>
  status: SaveStatus
  /** Open one field full-panel. */
  onEditField?: (field: EditorTextField) => void
}) {
  // Copy that lives on ANOTHER page gets its own heading and sits after the page you are
  // looking at (Sam, 2026-09-09: "a slot in the text page that says about and below that
  // should have the about text"). The panel does NOT filter — there are no page tabs, and
  // the row itself is how you get there.
  //
  // The first page keeps the prefix grouping it has always had, unheaded: `pageLabel` is
  // set only for a page that is not the first, so a single-page site takes the `else`
  // branch for everything and renders byte-for-byte as before.
  const here = textFields.filter((f) => !f.pageLabel)
  const elsewhere = new Map<string, EditorTextField[]>()
  for (const f of textFields) {
    if (!f.pageLabel) continue
    const bucket = elsewhere.get(f.pageLabel)
    if (bucket) bucket.push(f)
    else elsewhere.set(f.pageLabel, [f])
  }

  const row = (f: EditorTextField, heading: string) => {
    const value = values[f.key] ?? ''
    // Under a heading, drop the heading word — "Hero" › "Name", not "Hero name".
    // The full label stays the aria name (EditRow builds "Edit <label>").
    const rowLabel = sectionRowLabel(heading, f.label) || f.label
    // A style-only row is an AREA of the site (its words are the design's), so
    // its value is a note, not copy. An unset field falls back to the site's own
    // words when the manifest supplies them — "Empty" is useless to someone
    // looking at a page of words.
    const shown = f.styleOnly ? 'Set by the site — restyle only' : value || f.defaultValue || 'Not set'
    const empty = f.styleOnly || !(value || f.defaultValue)
    return <EditRow key={f.key} label={rowLabel} value={shown} empty={empty} onEdit={() => onEditField?.(f)} />
  }

  return (
    <div className="pb-2">
      {groupByPrefix(here).map(([heading, group]) => (
        <div key={heading || '_flat'}>
          {heading && <GroupLabel>{heading}</GroupLabel>}
          {group.map((f) => row(f, heading))}
        </div>
      ))}
      {[...elsewhere].map(([pageLabel, group]) => (
        <div key={`page:${pageLabel}`}>
          {/* The page's own name, straight from the site's declaration — never a word the
              editor invented for it (`editor-shows-what-site-sets`). */}
          <GroupLabel>{pageLabel}</GroupLabel>
          {/* No prefix grouping inside a page: its rows are already one section, and a
              second tier of headings over two rows is noise. */}
          {group.map((f) => row(f, ''))}
        </div>
      ))}
      <SaveLine status={status} />
    </div>
  )
}
