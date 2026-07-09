/**
 * driveClient — reads a PUBLIC ("anyone with the link") Google Drive folder with
 * one global API key (GOOGLE_API_KEY): no OAuth, no per-artist tokens. Browsing
 * lists a folder's audio/image/video files; importing downloads a file's bytes
 * (the copy-on-import model — see the Drive plan). Quirks owned here:
 *   - a PRIVATE folder doesn't 403 on files.list — it returns 200 with [] — so
 *     visibility checks must go through files.get on the folder itself (404);
 *   - `size` is an int64 STRING in Drive v3;
 *   - the API's thumbnailLink expires within hours; the stable keyless
 *     drive.google.com/thumbnail endpoint is used instead;
 *   - alt=media returns raw bytes (not JSON), with its own 429 loop + a byte cap
 *     enforced while reading (Content-Length can be absent).
 * A factory with injectable fetch/sleep for deterministic tests.
 */

import { httpGetJson } from '@/lib/http'

const API_BASE = 'https://www.googleapis.com/drive/v3'
/** Every request opts into shared drives; harmless for My Drive folders. */
const DRIVES = 'supportsAllDrives=true'

export type DriveKind = 'audio' | 'image' | 'video'

export type DriveFile = {
  id: string
  name: string
  mimeType: string
  kind: DriveKind
  /** Bytes, when Drive reports it (int64 string in the API). */
  size: number | null
  /** Stable public thumbnail (images/videos); null for audio. */
  thumbnailUrl: string | null
}

/**
 * Extract the folder id from a pasted Drive URL (or accept a bare id). The strict
 * [A-Za-z0-9_-] charset also guarantees the id can't break out of the files.list
 * `q` string (real ids never contain quotes).
 */
export function parseDriveFolderId(raw: string): string | null {
  const s = raw.trim()
  const folders = s.match(/\/folders\/([A-Za-z0-9_-]{10,})/)
  if (folders) return folders[1]
  const openId = s.match(/[?&]id=([A-Za-z0-9_-]{10,})/)
  if (openId) return openId[1]
  if (/^[A-Za-z0-9_-]{15,}$/.test(s)) return s
  return null
}

/** Which import bucket a MIME type belongs to; null for anything else (incl.
 *  Google-native docs — application/vnd.google-apps.*, which have no bytes). */
export function driveKind(mimeType: string): DriveKind | null {
  if (mimeType.startsWith('audio/')) return 'audio'
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/')) return 'video'
  return null
}

type ListResponse = {
  nextPageToken?: string
  files?: { id: string; name: string; mimeType: string; size?: string }[]
}

type FileMeta = { id: string; name: string; mimeType: string; size?: string; parents?: string[] }

type Options = {
  apiKey?: string
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  maxRetries?: number
  /** Hard cap on pagination, so a looping token can't spin forever. */
  maxPages?: number
}

export const FOLDER_NOT_SHARED =
  "That folder isn't shared publicly. In Drive, set it to “Anyone with the link” and try again."

export function createDriveClient(opts: Options = {}) {
  const doFetch = opts.fetchImpl ?? fetch
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  const maxRetries = opts.maxRetries ?? 3
  const maxPages = opts.maxPages ?? 20

  function key(): string {
    const k = opts.apiKey ?? process.env.GOOGLE_API_KEY
    if (!k) throw new Error('Google API key not configured (GOOGLE_API_KEY).')
    return k
  }

  function apiGet<T>(pathAndQuery: string): Promise<T> {
    return httpGetJson<T>(`${API_BASE}${pathAndQuery}&${DRIVES}&key=${key()}`, {
      fetchImpl: doFetch,
      sleep,
      maxRetries,
      provider: 'Google Drive',
    })
  }

  /**
   * The folder's metadata — the ONLY reliable share check: files.list on a
   * private folder quietly returns an empty list, but files.get 404s.
   */
  async function getFolder(folderId: string): Promise<{ id: string; name: string }> {
    let meta: { id: string; name: string; mimeType: string }
    try {
      meta = await apiGet(`/files/${folderId}?fields=id,name,mimeType`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      if (msg.includes('error 404') || msg.includes('error 403')) throw new Error(FOLDER_NOT_SHARED)
      throw e
    }
    if (meta.mimeType !== 'application/vnd.google-apps.folder') {
      throw new Error('That link points to a file, not a folder.')
    }
    return { id: meta.id, name: meta.name }
  }

  /** One PAGE of the folder's media files (name-ordered). Callers paginate with
   *  the returned token; 'all' spans the three media kinds (for the Check action). */
  async function listMediaFiles(
    folderId: string,
    kind: DriveKind | 'all',
    pageToken?: string | null,
  ): Promise<{ files: DriveFile[]; nextPageToken: string | null }> {
    const mime =
      kind === 'all'
        ? "(mimeType contains 'audio/' or mimeType contains 'image/' or mimeType contains 'video/')"
        : `mimeType contains '${kind}/'`
    const q = encodeURIComponent(`'${folderId}' in parents and trashed=false and ${mime}`)
    const page = await apiGet<ListResponse>(
      `/files?q=${q}&fields=${encodeURIComponent('nextPageToken,files(id,name,mimeType,size)')}` +
        `&pageSize=100&orderBy=name_natural&includeItemsFromAllDrives=true` +
        (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''),
    )
    const files: DriveFile[] = []
    for (const f of page.files ?? []) {
      // Never trust the query alone — re-derive the kind (drops Google-native docs).
      const k = driveKind(f.mimeType)
      if (!k || (kind !== 'all' && k !== kind)) continue
      const size = f.size != null && Number.isFinite(Number(f.size)) ? Number(f.size) : null
      files.push({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        kind: k,
        size,
        thumbnailUrl: k === 'audio' ? null : `https://drive.google.com/thumbnail?id=${f.id}&sz=w320`,
      })
    }
    return { files, nextPageToken: page.nextPageToken ?? null }
  }

  /** Every media file of a kind (bounded pagination) — for counts / import checks. */
  async function listAllMediaFiles(folderId: string, kind: DriveKind | 'all'): Promise<DriveFile[]> {
    const out: DriveFile[] = []
    const seen = new Set<string>()
    let token: string | null = null
    for (let page = 0; page < maxPages; page++) {
      const res: Awaited<ReturnType<typeof listMediaFiles>> = await listMediaFiles(folderId, kind, token)
      out.push(...res.files)
      token = res.nextPageToken
      if (!token || seen.has(token)) break
      seen.add(token)
    }
    return out
  }

  /** One file's metadata — fetched server-side at import so the client can never
   *  spoof name/MIME, and `parents` proves it belongs to the connected folder. */
  async function getFileMeta(
    fileId: string,
  ): Promise<{ id: string; name: string; mimeType: string; size: number | null; parents: string[] }> {
    const meta = await apiGet<FileMeta>(`/files/${fileId}?fields=id,name,mimeType,size,parents`)
    const size = meta.size != null && Number.isFinite(Number(meta.size)) ? Number(meta.size) : null
    return { id: meta.id, name: meta.name, mimeType: meta.mimeType, size, parents: meta.parents ?? [] }
  }

  /**
   * The file's raw bytes (alt=media — no JSON, so httpGetJson doesn't apply).
   * `maxBytes` is enforced while reading, not just via Content-Length: Drive can
   * answer identity-encoded with no length header.
   */
  async function downloadFile(fileId: string, maxBytes: number): Promise<ArrayBuffer> {
    const url = `${API_BASE}/files/${fileId}?alt=media&${DRIVES}&key=${key()}`
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const res = await doFetch(url)
      if (res.status === 429) {
        const parsed = Number(res.headers.get('retry-after') ?? '1')
        await sleep((Number.isFinite(parsed) && parsed > 0 ? parsed : 1) * 1000)
        continue
      }
      if (res.status === 403) throw new Error("Google won't allow downloading this file.")
      if (!res.ok) throw new Error(`Google Drive API error ${res.status}`)

      const declared = Number(res.headers.get('content-length') ?? '0')
      if (Number.isFinite(declared) && declared > maxBytes) throw new Error('FILE_TOO_LARGE')

      if (!res.body) {
        const buf = await res.arrayBuffer()
        if (buf.byteLength > maxBytes) throw new Error('FILE_TOO_LARGE')
        return buf
      }
      const reader = res.body.getReader()
      const chunks: Uint8Array[] = []
      let total = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > maxBytes) {
          await reader.cancel()
          throw new Error('FILE_TOO_LARGE')
        }
        chunks.push(value)
      }
      const out = new Uint8Array(total)
      let offset = 0
      for (const c of chunks) {
        out.set(c, offset)
        offset += c.byteLength
      }
      return out.buffer
    }
    throw new Error(`Google Drive API rate-limited after ${maxRetries} retries`)
  }

  return { getFolder, listMediaFiles, listAllMediaFiles, getFileMeta, downloadFile }
}

export type DriveClient = ReturnType<typeof createDriveClient>
