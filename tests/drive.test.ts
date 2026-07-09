/**
 * driveClient — the public-folder Google Drive reader (browse + copy-on-import).
 * Deterministic: injected fetch/sleep, no network. Locks the quirks the client
 * owns: private folders 404 only via files.get (files.list is a silent []), the
 * int64-string `size`, code-side kind re-filtering (Google-native docs have no
 * bytes), stable thumbnails, pagination, 429 backoff, and the download byte cap
 * enforced while reading.
 */
import { describe, expect, it, vi } from 'vitest'
import { FOLDER_NOT_SHARED, createDriveClient, driveKind, parseDriveFolderId } from '@/lib/drive'

const noSleep = () => Promise.resolve()

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

function client(fetchImpl: typeof fetch, extra: Record<string, unknown> = {}) {
  return createDriveClient({ apiKey: 'k', fetchImpl, sleep: noSleep, ...extra })
}

describe('parseDriveFolderId', () => {
  it.each([
    ['https://drive.google.com/drive/folders/1AbC_d-EFGhijk123?usp=sharing', '1AbC_d-EFGhijk123'],
    ['https://drive.google.com/drive/u/0/folders/1AbC_d-EFGhijk123', '1AbC_d-EFGhijk123'],
    ['https://drive.google.com/open?id=1AbC_d-EFGhijk123&authuser=0', '1AbC_d-EFGhijk123'],
    ['  1AbC_d-EFGhijk1234567  ', '1AbC_d-EFGhijk1234567'], // bare id, trimmed
  ])('extracts the id from %s', (input, id) => {
    expect(parseDriveFolderId(input)).toBe(id)
  })

  it.each(['https://example.com/whatever', 'not a link', "1abc'; drop--", ''])(
    'rejects %s',
    (input) => {
      expect(parseDriveFolderId(input)).toBeNull()
    },
  )
})

describe('driveKind', () => {
  it('buckets media MIME types and drops everything else', () => {
    expect(driveKind('audio/mpeg')).toBe('audio')
    expect(driveKind('image/png')).toBe('image')
    expect(driveKind('video/mp4')).toBe('video')
    expect(driveKind('application/pdf')).toBeNull()
    expect(driveKind('application/vnd.google-apps.document')).toBeNull()
  })
})

describe('getFolder', () => {
  it('maps a 404 (private or nonexistent) to the not-shared error', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 404 })) as unknown as typeof fetch
    await expect(client(fetchImpl).getFolder('f1')).rejects.toThrow(FOLDER_NOT_SHARED)
  })

  it('rejects a link that points at a file', async () => {
    const fetchImpl = (async () => json({ id: 'f1', name: 'song.mp3', mimeType: 'audio/mpeg' })) as typeof fetch
    await expect(client(fetchImpl).getFolder('f1')).rejects.toThrow(/file, not a folder/)
  })

  it('returns the folder metadata when public', async () => {
    const fetchImpl = (async () =>
      json({ id: 'f1', name: 'Assets', mimeType: 'application/vnd.google-apps.folder' })) as typeof fetch
    await expect(client(fetchImpl).getFolder('f1')).resolves.toEqual({ id: 'f1', name: 'Assets' })
  })
})

describe('listMediaFiles', () => {
  const FILES = {
    files: [
      { id: 'a1', name: 'demo.mp3', mimeType: 'audio/mpeg', size: '2048' },
      { id: 'i1', name: 'cover.png', mimeType: 'image/png', size: '512' },
      { id: 'd1', name: 'notes', mimeType: 'application/vnd.google-apps.document' },
    ],
  }

  it('maps files: string size → number, stable thumbnails, no thumbnail for audio', async () => {
    const fetchImpl = (async () => json(FILES)) as typeof fetch
    const { files } = await client(fetchImpl).listMediaFiles('f1', 'all')
    expect(files.map((f) => f.id)).toEqual(['a1', 'i1']) // the doc is dropped in code
    expect(files[0]).toMatchObject({ kind: 'audio', size: 2048, thumbnailUrl: null })
    expect(files[1].thumbnailUrl).toBe('https://drive.google.com/thumbnail?id=i1&sz=w320')
  })

  it('re-filters by kind in code even when the query already filtered', async () => {
    const fetchImpl = (async () => json(FILES)) as typeof fetch
    const { files } = await client(fetchImpl).listMediaFiles('f1', 'image')
    expect(files.map((f) => f.id)).toEqual(['i1'])
  })

  it('queries the folder with a kind filter and passes the page token through', async () => {
    const seen: string[] = []
    const fetchImpl = (async (url: RequestInfo | URL) => {
      seen.push(String(url))
      return json({ files: [], nextPageToken: 'tok2' })
    }) as typeof fetch
    const { nextPageToken } = await client(fetchImpl).listMediaFiles('f1', 'audio', 'tok1')
    expect(nextPageToken).toBe('tok2')
    const url = decodeURIComponent(seen[0])
    expect(url).toContain("'f1' in parents")
    expect(url).toContain("mimeType contains 'audio/'")
    expect(url).toContain('pageToken=tok1')
  })

  it('backs off on 429 using Retry-After, then succeeds', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls++
      if (calls === 1) return new Response('', { status: 429, headers: { 'retry-after': '1' } })
      return json({ files: [] })
    }) as typeof fetch
    const { files } = await client(fetchImpl).listMediaFiles('f1', 'all')
    expect(files).toEqual([])
    expect(calls).toBe(2)
  })

  it('throws a clear setup error when no API key is configured', async () => {
    const prev = process.env.GOOGLE_API_KEY
    delete process.env.GOOGLE_API_KEY
    try {
      const c = createDriveClient({ fetchImpl: (async () => json({})) as typeof fetch, sleep: noSleep })
      await expect(c.listMediaFiles('f1', 'all')).rejects.toThrow(/GOOGLE_API_KEY/)
    } finally {
      if (prev != null) process.env.GOOGLE_API_KEY = prev
    }
  })
})

describe('listAllMediaFiles', () => {
  it('follows nextPageToken across pages', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls++
      return calls === 1
        ? json({ files: [{ id: 'a1', name: 'a.mp3', mimeType: 'audio/mpeg' }], nextPageToken: 't2' })
        : json({ files: [{ id: 'a2', name: 'b.mp3', mimeType: 'audio/mpeg' }] })
    }) as typeof fetch
    const files = await client(fetchImpl).listAllMediaFiles('f1', 'audio')
    expect(files.map((f) => f.id)).toEqual(['a1', 'a2'])
  })
})

describe('downloadFile', () => {
  it('returns the raw bytes', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    const fetchImpl = (async () => new Response(bytes)) as typeof fetch
    const buf = await client(fetchImpl).downloadFile('a1', 100)
    expect(new Uint8Array(buf)).toEqual(bytes)
  })

  it('rejects oversize via Content-Length before reading', async () => {
    const fetchImpl = (async () =>
      new Response('x', { headers: { 'content-length': '999999' } })) as typeof fetch
    await expect(client(fetchImpl).downloadFile('a1', 100)).rejects.toThrow('FILE_TOO_LARGE')
  })

  it('rejects oversize while reading when no Content-Length is sent', async () => {
    const big = new Uint8Array(200)
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(big)
        c.close()
      },
    })
    const fetchImpl = (async () => new Response(stream)) as typeof fetch
    await expect(client(fetchImpl).downloadFile('a1', 100)).rejects.toThrow('FILE_TOO_LARGE')
  })

  it('maps 403 to a friendly cannot-download error', async () => {
    const fetchImpl = (async () => new Response('', { status: 403 })) as typeof fetch
    await expect(client(fetchImpl).downloadFile('a1', 100)).rejects.toThrow(/won't allow downloading/)
  })

  it('retries a 429 then succeeds', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls++
      if (calls === 1) return new Response('', { status: 429, headers: { 'retry-after': '1' } })
      return new Response(new Uint8Array([9]))
    }) as typeof fetch
    const buf = await client(fetchImpl).downloadFile('a1', 100)
    expect(new Uint8Array(buf)).toEqual(new Uint8Array([9]))
    expect(calls).toBe(2)
  })
})
