import { cx } from '@/lib/cx'
import { type EditorTextField } from '../inspector-types'
import { FieldRow, SaveLine, FIELD, EditButton, type SaveStatus } from '../inspector-shared'

/* ── Text tools: edit the site's headings, taglines, bio, booking copy ─────────
 *
 * The list is for TYPING, and nothing else. Anything more — the type controls, and
 * whatever a single field grows later — lives behind Edit in the full-panel editor,
 * exactly like an image or a video slot. Controls inline made every row three rows tall
 * and turned a scannable list of the site's copy into a wall.
 *
 * Values and their debounced save live ABOVE this component (`useTextFieldSave`), because
 * the editor is a second window onto the same field: two copies of the state would show
 * a stale value after an edit and race each other's writes.
 */
export function TextTools({
  textFields,
  values,
  status,
  onEdit,
  onEditField,
}: {
  textFields: EditorTextField[]
  values: Record<string, string>
  status: SaveStatus
  onEdit: (key: string, value: string) => void
  /** Open one field full-panel. */
  onEditField?: (field: EditorTextField) => void
}) {
  return (
    <div className="py-2">
      {textFields.map((f) => (
        <div key={f.key} className="px-5">
          {/* No leading icon: one glyph per row down a column of text fields is noise,
              and the label already says what the field is. */}
          <FieldRow
            label={f.label}
            action={onEditField ? <EditButton label={f.label} onClick={() => onEditField(f)} /> : undefined}
          >
            {f.multiline ? (
              <textarea
                value={values[f.key] ?? ''}
                onChange={(e) => onEdit(f.key, e.target.value)}
                aria-label={f.label}
                className={cx(FIELD, 'min-h-20 resize-y leading-relaxed')}
              />
            ) : (
              <input
                type={f.type === 'email' ? 'email' : 'text'}
                value={values[f.key] ?? ''}
                onChange={(e) => onEdit(f.key, e.target.value)}
                aria-label={f.label}
                className={FIELD}
              />
            )}
          </FieldRow>
        </div>
      ))}
      <SaveLine status={status} />
    </div>
  )
}
