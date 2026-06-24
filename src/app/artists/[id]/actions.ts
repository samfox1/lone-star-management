'use server'

/**
 * Content server actions for one artist's dashboard. Generic over content type
 * (track / tour_date / merch / link). Each builds the request-bound Supabase
 * client (RLS scopes every write to the caller's tenant), extracts the type's
 * editable fields from FormData, and revalidates. type/id/artistId are bound as
 * leading args from the page.
 */
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import {
  type EntityType,
  ENTITIES,
  createContent,
  deleteContent,
  publishAll,
  updateContent,
} from '@/lib/content'
import { isUrlField, safeHref } from '@/lib/url'

const NUMERIC = new Set(['price', 'sort_order'])

/**
 * Pull a type's editable fields out of FormData. Numbers are coerced and
 * rejected if non-finite; URL fields with a dangerous scheme are dropped so
 * they never persist (render-time safeHref is still the primary guard).
 */
/** Coerce/validate one raw field value; undefined means "drop it". */
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

/** Create: only fields the user actually filled (empty → use the DB default). */
function extractFields(type: EntityType, formData: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of ENTITIES[type].fields) {
    const raw = String(formData.get(field) ?? '').trim()
    if (raw === '') continue
    const value = coerce(field, raw)
    if (value !== undefined) out[field] = value
  }
  return out
}

/**
 * Update: only fields present in the submitted form are touched (absent fields
 * are left alone). An empty optional field is set to null so a manager can clear
 * it; a required (NOT NULL) field is never nulled.
 */
function extractUpdate(type: EntityType, formData: FormData): Record<string, unknown> {
  const required = new Set(ENTITIES[type].required)
  const out: Record<string, unknown> = {}
  for (const field of ENTITIES[type].fields) {
    if (!formData.has(field)) continue
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

export async function addContentAction(
  type: EntityType,
  artistId: string,
  formData: FormData,
) {
  const input = extractFields(type, formData)
  if (Object.keys(input).length === 0) return
  const supabase = await createClient()
  await createContent(supabase, type, artistId, input)
  revalidatePath(`/artists/${artistId}`)
}

export async function updateContentAction(
  type: EntityType,
  id: string,
  artistId: string,
  formData: FormData,
) {
  const input = extractUpdate(type, formData)
  if (Object.keys(input).length === 0) return
  const supabase = await createClient()
  await updateContent(supabase, type, id, input)
  revalidatePath(`/artists/${artistId}`)
}

export async function deleteContentAction(
  type: EntityType,
  id: string,
  artistId: string,
) {
  const supabase = await createClient()
  await deleteContent(supabase, type, id)
  revalidatePath(`/artists/${artistId}`)
}

export async function publishAction(artistId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  await publishAll(supabase, artistId, user?.id)
  revalidatePath(`/artists/${artistId}`)
}
