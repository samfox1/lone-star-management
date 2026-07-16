/**
 * How a manager's FORM becomes a content row: the rule that turns submitted
 * FormData into the column set for `createContent` / `updateContent`, honouring the
 * per-type allowlist in `CRUD` (lib/content.ts).
 *
 * This is its own module rather than a helper inside the dashboard's actions.ts
 * because that file is `'use server'`, where every export must be an async server
 * action — so these could not be exported, and the create/update contract could only
 * be tested through a request-bound Supabase client. The rule is pure (FormData in,
 * plain object out), so here it has an interface of its own and tests to match.
 */
import { CRUD, type GenericEntity } from '@/lib/content'
import { isUrlField, safeHref } from '@/lib/url'

const NUMERIC = new Set(['price', 'sort_order'])

/** Fields that are boolean columns: the form posts 'true'/'false' (a BoolToggle's
 *  hidden input), coerced to a real boolean here. */
const BOOLEAN_FIELDS = new Set(['is_past'])

/**
 * Fields posted as REPEATED FormData entries — one per chip from a TagInput —
 * rather than a single value. Read with `getAll`, never `get`: `get` would silently
 * return only the first tag.
 */
const ARRAY_FIELDS = new Set(['support'])

/** Cap on tags per array field, matching parseContributors' cap for a song's
 *  featured artists. A bill has a handful of acts; this is an abuse bound. */
const MAX_TAGS = 20

/** Coerce/validate one raw scalar field value; undefined means "drop it". Array and
 *  boolean fields are handled by their callers before this runs. */
function coerce(field: string, raw: string): unknown {
  if (NUMERIC.has(field)) {
    const n = Number(raw)
    return Number.isFinite(n) ? n : undefined
  }
  if (isUrlField(field)) {
    return safeHref(raw) !== undefined ? raw : undefined
  }
  return raw
}

/**
 * The tags posted for an array field: trimmed, blanks dropped, capped. Dropping
 * blanks is what discards TagInput's presence sentinel (see tag-input.tsx), so the
 * sentinel can never become a tag.
 */
function tagList(formData: FormData, field: string): string[] {
  return formData
    .getAll(field)
    .map((v) => String(v).trim())
    .filter(Boolean)
    .slice(0, MAX_TAGS)
}

/** Create: only fields the user actually filled (empty → use the DB default). */
export function extractFields(type: GenericEntity, formData: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of CRUD[type].fields) {
    if (ARRAY_FIELDS.has(field)) {
      // Empty is omitted, not written: the column's DB default ('{}') should win on
      // create, exactly as an untouched text field falls through to its default.
      const list = tagList(formData, field)
      if (list.length) out[field] = list
      continue
    }
    if (BOOLEAN_FIELDS.has(field)) {
      // A boolean column is NOT NULL, so it must never fall to the empty→null path
      // below. An untouched toggle is omitted (the DB default wins); a set one writes
      // a real boolean.
      const raw = String(formData.get(field) ?? '').trim()
      if (raw !== '') out[field] = raw === 'true'
      continue
    }
    const raw = String(formData.get(field) ?? '').trim()
    if (raw === '') continue
    const value = coerce(field, raw)
    if (value !== undefined) out[field] = value
  }
  return out
}

/**
 * Update: only fields present in the submitted form are touched (absent fields are
 * left alone). An empty optional field is set to null so a manager can clear it; a
 * required (NOT NULL) field is never nulled.
 */
export function extractUpdate(type: GenericEntity, formData: FormData): Record<string, unknown> {
  const required = new Set(CRUD[type].required)
  const out: Record<string, unknown> = {}
  for (const field of CRUD[type].fields) {
    if (!formData.has(field)) continue
    if (ARRAY_FIELDS.has(field)) {
      // Always written, so removing every chip actually CLEARS the column. This is
      // why TagInput posts a blank sentinel: with zero chips there would otherwise be
      // no `support` entry at all, `has` would be false, and a cleared list would
      // silently keep its old value. These columns are NOT NULL, so this writes [].
      out[field] = tagList(formData, field)
      continue
    }
    if (BOOLEAN_FIELDS.has(field)) {
      // NOT NULL — must never reach the empty→null branch below. BoolToggle always
      // posts 'true'/'false'; a blank (some other caller) coerces to false, never null.
      out[field] = String(formData.get(field) ?? '').trim() === 'true'
      continue
    }
    const raw = String(formData.get(field) ?? '').trim()
    if (raw === '') {
      if (!required.has(field)) out[field] = null
      continue
    }
    const value = coerce(field, raw)
    if (value !== undefined) out[field] = value
  }
  return out
}
