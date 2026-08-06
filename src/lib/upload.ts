/**
 * Pure upload logic, lifted out of the uploader components so validation, path
 * building, and the upload→row-write→orphan-cleanup dance are unit-testable (they used
 * to be buried in onChange handlers, each hand-rolling the same rollback). The React
 * hook (useStorageUpload) and FileDropField are thin wrappers over these.
 */

export type UploadRules = { allowedExt: string[]; maxBytes: number; allowedMime?: string[] }
export type ValidateResult = { ok: true; ext: string } | { ok: false; error: string }

/** The image/video upload rules, in ONE place — they were copy-pasted per uploader
 *  (media-uploader twice, the editor's Images panel) and would drift the first time one
 *  was edited. Client-side UX only; the bucket's limits are the real guard. */
export const IMAGE_UPLOAD_RULES: UploadRules = {
  allowedExt: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
  maxBytes: 26214400,
  allowedMime: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
}
export const VIDEO_UPLOAD_RULES: UploadRules = {
  allowedExt: ['mp4', 'webm', 'mov'],
  maxBytes: 524288000,
  allowedMime: ['video/mp4', 'video/webm', 'video/quicktime'],
}
/** Track/song audio, in ONE place for the same reason as the image rules: three uploaders
 *  hand-rolled this list and one had already drifted — song-add accepted `audio/x-m4a`
 *  (what Safari and Windows report for an .m4a) while the other two rejected the very
 *  same file. 30 MB is the cap all three already enforced. */
export const AUDIO_UPLOAD_RULES: UploadRules = {
  allowedExt: ['mp3', 'm4a'],
  maxBytes: 31457280, // 30 MB
  allowedMime: ['audio/mpeg', 'audio/mp4', 'audio/x-m4a'],
}
/**
 * Press-kit DOCUMENTS: the stage plot and tech rider on the EPK.
 *
 * A SEPARATE constant, not a widened IMAGE_UPLOAD_RULES, so a PDF can never be accepted
 * by an uploader that expects an image (and vice versa) — the two are widened for
 * different reasons and must not move together.
 *
 * PDF only. `application/pdf` is the one document type a browser renders inline without
 * scripting, and it is what a promoter expects to receive; adding an office format would
 * mean either converting it or handing over a file half of them can't open. The cap is
 * deliberately far below the image limit — a rider is a few pages, and these get fetched
 * and stapled onto the generated EPK at download time, so size is latency for everyone.
 */
export const DOCUMENT_UPLOAD_RULES: UploadRules = {
  allowedExt: ['pdf'],
  maxBytes: 10485760, // 10 MB
  allowedMime: ['application/pdf'],
}
/**
 * Uploaded FONT files (lib/fonts.ts). Four formats: woff2 is what should actually ship,
 * the other three because a foundry licence often hands over only a TTF or OTF.
 *
 * SVG is absent and must stay absent. An SVG "font" is a dead format and a live
 * script-execution vector, and the `fonts` bucket is PUBLIC-READ — a fan's browser
 * fetches the file directly — so one served as image/svg+xml from the Supabase origin is
 * stored XSS on that origin.
 *
 * 2 MB, well under the image cap: this file blocks first paint of the artist's own name,
 * and a subsetted woff2 is 20-80 KB. A 15 MB TTF with every CJK glyph in it is not a
 * thing to serve a fan on mobile data.
 *
 * THE MIME LIST IS DELIBERATELY WIDE, and it is the client-side half only. What browsers
 * report for these extensions was measured, not assumed: macOS reports `font/ttf` for a
 * .ttf and NOTHING at all for a .woff2 (no registered UTI), Windows reports
 * `application/octet-stream` for .ttf and .otf because neither has a registry mime entry,
 * and older Linux stacks still say `application/x-font-ttf`. A strict list here rejects
 * real fonts on real machines, so TTF and OTF are effectively matched by EXTENSION.
 * That costs nothing, because the guard that matters is elsewhere: the uploader sends
 * `contentTypeFor(ext)` — always one of the four `font/*` types — and the bucket's
 * allowed_mime_types accepts ONLY those four. `application/octet-stream` appears here and
 * must NEVER appear in the bucket's list, where it would admit any file at all.
 */
export const FONT_UPLOAD_RULES: UploadRules = {
  allowedExt: ['woff2', 'woff', 'ttf', 'otf'],
  maxBytes: 2097152, // 2 MB
  allowedMime: [
    'font/woff2',
    'font/woff',
    'font/ttf',
    'font/otf',
    'font/sfnt',
    'application/font-woff',
    'application/x-font-woff',
    'application/font-woff2',
    'application/x-font-ttf',
    'application/x-font-truetype',
    'application/x-font-otf',
    'application/x-font-opentype',
    'application/vnd.ms-opentype',
    'application/font-sfnt',
    'application/octet-stream',
  ],
}

/** Human-readable size, binary (MiB) so it matches the bucket's file_size_limit and
 *  the "up to 500 MB" hints: 524288000 → "500 MB", 31457280 → "30 MB". */
export function sizeLabel(bytes: number): string {
  const mib = bytes / (1024 * 1024)
  return mib >= 1024 ? `${(mib / 1024).toFixed(1)} GB` : `${Math.round(mib)} MB`
}

const upperList = (exts: string[]) => exts.map((e) => e.toUpperCase()).join(', ')

/** The file-picker `accept` list, derived from the SAME rules validateUpload enforces —
 *  never a wildcard. A hand-written attribute is how the logo picker advertised
 *  `image/*` (which admits SVG, a stored-XSS vector on the public bucket) while the
 *  validator refused it. */
export function acceptFor(rules: UploadRules): string {
  return [...(rules.allowedMime ?? []), ...rules.allowedExt.map((e) => `.${e}`)].join(',')
}

/** Validate a picked file against ext + size (+ optional mime). Client-side UX only —
 *  the bucket's allowed_mime_types / file_size_limit are the real, unbypassable guard.
 *  Messages name the specific allowed types and the exact limit. */
export function validateUpload(file: { name: string; size: number; type: string }, rules: UploadRules): ValidateResult {
  const allowed = upperList(rules.allowedExt)
  const dot = file.name.lastIndexOf('.')
  if (dot <= 0 || dot === file.name.length - 1)
    return { ok: false, error: `That file has no extension — upload a ${allowed} file.` }
  const ext = file.name.slice(dot + 1).toLowerCase()
  if (!rules.allowedExt.includes(ext))
    return { ok: false, error: `.${ext} isn't supported — upload a ${allowed} file.` }
  // A present-but-wrong mime is a spoof; a blank mime (browsers report m4a/mov oddly) is tolerated.
  if (rules.allowedMime && file.type && !rules.allowedMime.includes(file.type))
    return { ok: false, error: `That file doesn't look like a ${allowed}.` }
  if (file.size > rules.maxBytes)
    return {
      ok: false,
      error: `That file is ${sizeLabel(file.size)} — the limit is ${sizeLabel(rules.maxBytes)}.${oversizeFix(ext)}`,
    }
  return { ok: true, ext }
}

/**
 * The FIX for an over-size file, appended to the rejection (asset-compression brief,
 * skeen repo). The verdict alone tells a manager they failed; "compress it first"
 * without HOW is a dead end for someone without the tools. Video and fonts get one
 * plain-words sentence — the browser can't shrink either well, so instructions ARE the
 * gate. Images get nothing here: the editor's compression modal does that work FOR the
 * manager, and instructions would describe work nobody has to do.
 */
function oversizeFix(ext: string): string {
  if (['mp4', 'webm', 'mov'].includes(ext))
    return ' Export it at 1080p with the H.264 codec (the “YouTube 1080p” preset in most editors; in QuickTime, File → Export As → 1080p) — that usually lands a background clip well under the limit.'
  if (['ttf', 'otf', 'woff', 'woff2'].includes(ext))
    return ' Convert it to WOFF2 (search “woff2 converter”) — it typically shrinks a desktop font by 10× with no visual change.'
  return ''
}

/**
 * Turn a raw Supabase Storage / Postgres error into a specific, manager-facing message
 * — never a stack trace or "row-level security policy" jargon. The upload UI shows the
 * result, so it must say exactly what went wrong and (where known) what to do.
 */
export function friendlyUploadError(raw: string, ctx: { noun: string; allowed?: string[]; maxBytes?: number }): string {
  const r = (raw || '').toLowerCase()
  const noun = ctx.noun
  const allowed = ctx.allowed ? upperList(ctx.allowed) : null

  if (/mime|not supported|unsupported|content.?type|invalid_?mime|\b415\b/.test(r))
    return allowed ? `That file type isn't supported — upload a ${allowed} file.` : `That file type isn't supported.`
  // A 413 is the SERVER's limit (bucket/project global) — which the client can't read
  // and may not match our own maxBytes — so don't quote a possibly-wrong number here.
  // (Our client-side validateUpload does name the exact limit it enforces.)
  if (/too large|exceeded|maximum allowed size|maximum size|payload too large|\b413\b|file size/.test(r))
    return `That ${noun} is too large to upload. Try a smaller or compressed file.`
  if (/row-level security|violates.*policy|not authorized|unauthorized|permission|\b403\b/.test(r))
    return `You don't have permission to upload this ${noun}. Try signing out and back in.`
  if (/already exists|duplicate|\b409\b/.test(r)) return `A file with that name already exists — try again.`
  if (/failed to fetch|networkerror|network error|timeout|timed out|econn|fetch failed|\b5\d\d\b/.test(r))
    return `Upload failed — check your connection and try again.`
  return `Couldn't upload that ${noun}. Please try again.`
}

/** `{artistId}/{category}/{uuid}.{ext}` — a server-random filename, never the user's
 *  (kills the filename-injection surface + collisions). */
export function buildStoragePath(artistId: string, category: string, ext: string, uuid: string = crypto.randomUUID()): string {
  return `${artistId}/${category}/${uuid}.${ext.toLowerCase()}`
}

/**
 * Does this storage path belong to `artistId`, in the shape `buildStoragePath` produces?
 *
 * A path arrives from the CLIENT: the browser uploads direct-to-Storage, then asks a
 * server action to record where it put the object. Storage's own RLS policies pin the
 * upload to `{artistId}/…`, and the row's RLS pins the tenant — but nothing tied the two
 * together, so a manager could record a row pointing at any path at all: another artist's
 * folder, another bucket's shape, or a traversal string that `mediaUrl` would happily
 * concatenate into a URL and serve on their public site.
 *
 * Bounded damage (the objects it could point at are public anyway, and the row itself
 * still can't cross tenants), which is why this is a hardening step rather than a
 * breach fix — but it was the one boundary here held by convention alone.
 *
 * Deliberately strict: the tenant prefix, a simple folder name, a UUID filename, a short
 * extension. Everything the app writes goes through `buildStoragePath`, so anything that
 * fails this was not written by the normal path.
 */
export function isOwnedStoragePath(artistId: string, path: string): boolean {
  if (typeof path !== 'string' || path.includes('..')) return false
  const re = new RegExp(
    `^${artistId.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}/[a-z0-9-]{1,32}/[0-9a-f-]{36}\\.[a-z0-9]{2,5}$`,
  )
  return re.test(path)
}

const CONTENT_TYPES: Record<string, string> = {
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  pdf: 'application/pdf',
  // The RFC 8081 `font/*` types, which is what the `fonts` bucket allows. Set explicitly
  // for exactly the reason this map exists: browsers report fonts inconsistently (macOS
  // sends nothing for a .woff2, Windows sends application/octet-stream for a .ttf), and
  // an upload carrying either of those is refused by the bucket.
  woff2: 'font/woff2',
  woff: 'font/woff',
  ttf: 'font/ttf',
  otf: 'font/otf',
}
/** A content-type the bucket's allowed_mime_types will accept (browsers report some
 *  formats inconsistently, so we set it explicitly rather than trust file.type). */
export function contentTypeFor(ext: string): string | undefined {
  return CONTENT_TYPES[ext.toLowerCase()]
}

/** Minimal slice of the supabase storage client performUpload needs. */
type UploadClient = {
  storage: {
    from: (bucket: string) => {
      upload: (path: string, file: unknown, opts?: unknown) => Promise<{ error: { message: string } | null }>
      remove: (paths: string[]) => Promise<unknown>
    }
  }
}

/**
 * Upload the object, then run the caller's row write. If the row write fails, REMOVE
 * the just-uploaded object so it can't orphan (the object was never referenced by any
 * revision, so this is safe — unlike deleting an established, possibly-published video,
 * whose object must be GC'd at the tombstone step, never here).
 * `writeRow` returns an error message, or null on success.
 */
export async function performUpload(args: {
  supabase: UploadClient
  bucket: string
  path: string
  file: unknown
  contentType?: string
  writeRow: (path: string) => Promise<string | null>
  /** Optional transport (e.g. resumable/tus with progress). Returns an error message
   *  or null. When omitted, a single .upload() is used. On transfer failure we do NOT
   *  remove the object — a resumable transport may resume the partial later. */
  transfer?: () => Promise<string | null>
}): Promise<{ ok: true } | { error: string }> {
  const store = args.supabase.storage.from(args.bucket)
  const upErr = args.transfer
    ? await args.transfer()
    : (await store.upload(args.path, args.file, { contentType: args.contentType, upsert: false })).error?.message ?? null
  if (upErr) return { error: upErr }
  const rowErr = await args.writeRow(args.path)
  if (rowErr) {
    await store.remove([args.path])
    return { error: rowErr }
  }
  return { ok: true }
}

/** A byte-fraction (0..1) as a whole-percent label, floored (never "100%" until done)
 *  and clamped. Used by the upload progress bar. */
export function formatProgress(fraction: number): string {
  return `${Math.max(0, Math.min(100, Math.floor(fraction * 100)))}%`
}
