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
  return (
    <div className="py-2">
      {groupByPrefix(textFields).map(([heading, group]) => (
        <div key={heading || '_flat'}>
          {heading && <GroupLabel>{heading}</GroupLabel>}
          {group.map((f) => {
            const value = values[f.key] ?? ''
            // Under a heading, drop the heading word — "Hero" › "Name", not "Hero name".
            // The full label stays the aria name (EditRow builds "Edit <label>").
            const rowLabel = sectionRowLabel(heading, f.label) || f.label
            // A style-only row is an AREA of the site (its words are the design's), so
            // its value is a note, not copy. An unset field falls back to the site's own
            // words when the manifest supplies them — "Empty" is useless to someone
            // looking at a page of words.
            const shown = f.styleOnly
              ? 'Set by the site — restyle only'
              : value || f.defaultValue || 'Not set'
            const empty = f.styleOnly || !(value || f.defaultValue)
            return (
              <EditRow
                key={f.key}
                label={rowLabel}
                value={shown}
                empty={empty}
                onEdit={() => onEditField?.(f)}
              />
            )
          })}
        </div>
      ))}
      <SaveLine status={status} />
    </div>
  )
}
