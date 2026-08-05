import { cx } from '@/lib/cx'
import { type EditorTextField } from '../inspector-types'
import { CONTROL_LABEL, SaveLine, EditButton, type SaveStatus } from '../inspector-shared'

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
      {textFields.map((f) => {
        const value = values[f.key] ?? ''
        return (
          <div key={f.key} className="px-5 py-1.5">
            {/* No leading icon: one glyph per row down a column of text fields is noise
                the label already covers. */}
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className={CONTROL_LABEL}>{f.label}</span>
              {onEditField && <EditButton label={f.label} onClick={() => onEditField(f)} />}
            </div>
            {/* The current copy, shown not typed. Truncated to two lines: this is a list
                to scan, and a bio would otherwise push every field below it off screen. */}
            <p
              className={cx(
                'line-clamp-2 rounded-lg border border-hairline bg-surface px-2.5 py-1.5 text-[12px] leading-snug',
                value ? 'text-ink' : 'italic text-ink-faint',
              )}
            >
              {value || 'Empty'}
            </p>
          </div>
        )
      })}
      <SaveLine status={status} />
    </div>
  )
}
