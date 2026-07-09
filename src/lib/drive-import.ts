/**
 * Drive copy-on-import: pull one file's bytes out of the artist's connected
 * public Drive folder and land it in OUR storage + tables, so an imported file
 * behaves exactly like a direct upload (gated audio, publish flow, GC — all
 * unchanged). Pure over injected clients so the live-DB test exercises the real
 * thing; the server actions are thin wrappers. Uses the manager's RLS-scoped
 * server client — the bucket policies pass because every path starts with
 * `{artistId}/`, same as browser-direct uploads.
 */

import { buildStoragePath, contentTypeFor, performUpload, sizeLabel, type UploadRules } from '@/lib/upload'
import { driveKind, type DriveClient, type DriveKind } from '@/lib/drive'

// The minimal structural client slice (storage per performUpload + table inserts),
// so both the server client and the test's supabase-js client fit.
type DbClient = Parameters<typeof performUpload>[0]['supabase'] & {
  from: (table: string) => {
    insert: (row: Record<string, unknown>) => Promise<{ error: { code?: string; message: string } | null }>
  }
}

type ImportConfig = {
  bucket: 'audio' | 'videos' | 'media'
  /** buildStoragePath's middle segment — matches each bucket's existing layout. */
  category: string
  rules: UploadRules
  /** Server-copy cap. The import buffers the file in a server action, so this can
   *  be tighter than the bucket's own limit (video: 100 MB vs the bucket's 500). */
  maxBytes: number
  noun: string
}

const MB = 1024 * 1024

export const DRIVE_IMPORT: Record<DriveKind, ImportConfig> = {
  // Mirrors TrackAudioUploader's rules.
  audio: { bucket: 'audio', category: 'audio', rules: { allowedExt: ['mp3', 'm4a'], maxBytes: 30 * MB }, maxBytes: 30 * MB, noun: 'song' },
  // Mirrors MediaUploader's image rules.
  image: { bucket: 'media', category: 'gallery', rules: { allowedExt: ['jpg', 'jpeg', 'png', 'webp', 'gif'], maxBytes: 25 * MB }, maxBytes: 25 * MB, noun: 'image' },
  // Bucket allows 500 MB, but a server action buffers the whole file — cap at 100.
  video: { bucket: 'videos', category: 'videos', rules: { allowedExt: ['mp4', 'mov', 'webm'], maxBytes: 100 * MB }, maxBytes: 100 * MB, noun: 'video' },
}

/** The file's display title: its name without the extension. */
function titleFrom(name: string): string {
  const dot = name.lastIndexOf('.')
  return (dot > 0 ? name.slice(0, dot) : name).trim().slice(0, 120) || 'Untitled'
}

function extFrom(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/**
 * Copy one Drive file into Lone Star. Metadata is re-fetched server-side (the
 * client sends only a file id) and the file must live in the artist's CONNECTED
 * folder — otherwise this would be a generic "copy any public Drive file" proxy.
 * Ordering mirrors performUpload: upload → row insert → object removed on row
 * failure, so nothing orphans. A re-import trips the (artist_id, drive_file_id)
 * partial unique index → friendly "already imported".
 */
export async function importDriveFile(
  supabase: DbClient,
  drive: DriveClient,
  args: { artistId: string; kind: DriveKind; fileId: string; folderId: string },
): Promise<{ ok: true } | { error: string }> {
  const cfg = DRIVE_IMPORT[args.kind]

  const meta = await drive.getFileMeta(args.fileId)
  const article = /^[aeiou]/.test(cfg.noun) ? 'an' : 'a'
  if (driveKind(meta.mimeType) !== args.kind) return { error: `That file isn't ${article} ${cfg.noun}.` }
  if (!meta.parents.includes(args.folderId)) return { error: "That file isn't in the connected Drive folder." }

  const ext = extFrom(meta.name)
  if (!cfg.rules.allowedExt.includes(ext)) {
    const allowed = cfg.rules.allowedExt.map((e) => e.toUpperCase()).join(', ')
    return { error: `.${ext || '?'} isn't supported — Drive import takes ${allowed} files.` }
  }
  if (meta.size != null && meta.size > cfg.maxBytes) {
    return {
      error: `That ${cfg.noun} is ${sizeLabel(meta.size)} — Drive import handles up to ${sizeLabel(cfg.maxBytes)}. Upload it directly instead.`,
    }
  }

  let bytes: ArrayBuffer
  try {
    bytes = await drive.downloadFile(args.fileId, cfg.maxBytes)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Download failed.'
    if (msg === 'FILE_TOO_LARGE')
      return { error: `That ${cfg.noun} is over ${sizeLabel(cfg.maxBytes)} — upload it directly instead.` }
    return { error: msg }
  }

  const path = buildStoragePath(args.artistId, cfg.category, ext)
  const title = titleFrom(meta.name)

  const rowFor = (storagePath: string): Record<string, unknown> => {
    switch (args.kind) {
      case 'audio':
        // Manual + hosted audio + no platform linkage ⇒ an UNRELEASED song (lib/music.ts).
        return { artist_id: args.artistId, title, source: 'manual', audio_path: storagePath, drive_file_id: args.fileId }
      case 'video':
        // Same row VideoUpload writes: uploaded provider, off-site until published.
        return { artist_id: args.artistId, title, provider: 'uploaded', storage_path: storagePath, source: 'manual', visible: false, drive_file_id: args.fileId }
      case 'image':
        return { artist_id: args.artistId, purpose: 'gallery_image', storage_path: storagePath, drive_file_id: args.fileId }
    }
  }
  const table = args.kind === 'audio' ? 'tracks' : args.kind === 'video' ? 'videos' : 'media'

  const res = await performUpload({
    supabase,
    bucket: cfg.bucket,
    path,
    file: bytes,
    contentType: contentTypeFor(ext),
    writeRow: async (storagePath) => {
      const { error } = await supabase.from(table).insert(rowFor(storagePath))
      if (!error) return null
      if (error.code === '23505') return 'Already imported from Drive.'
      return error.message
    },
  })
  return 'error' in res ? { error: res.error } : { ok: true }
}
