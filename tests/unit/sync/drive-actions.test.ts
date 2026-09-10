/**
 * The four Google Drive SERVER ACTIONS (dashboard/actions.ts): save the folder,
 * check it, list a page of it, import one file. Nothing covered them — drive.test.ts
 * unit-tests the HTTP client and drive-import.test.ts exercises the pure
 * `importDriveFile` underneath, so both bypass the actions entirely, and every
 * component test mocks this module away.
 *
 * These actions take CLIENT-SUPPLIED ids and reach an external API with the
 * manager's API key, so two things have to hold and neither did:
 *
 *  - the fileId charset guard. `getFileMeta`/`downloadFile` interpolate the id
 *    straight into the Drive URL (`/files/${fileId}?fields=…`), so an id carrying
 *    `?`, `&`, `/` or `..` rewrites the request the server makes — a path/query
 *    injection against Google with our key attached. The guard is the only thing
 *    between a caller and that fetch, and it must fire BEFORE any of it.
 *  - ownership. A caller who doesn't manage the artist must get nothing back.
 *
 * The Drive client is faked: these tests must never make a real API call.
 * Assertions are paired — the return value AND that the effect was never reached,
 * because checking the return alone still passes if a refactor validates after the
 * work is done.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { importDriveFile } from '@/lib/drive-import'
import { createClient } from '@/lib/supabase/server'
import { FOLDER_NOT_SHARED, type DriveFile } from '@/lib/drive'

const FOLDER = '1AbC_dEfGhIjKlMnOpQrS'
const ARTIST = 'a1'

/** What the RLS-scoped `artists` read returns. `null` = the caller doesn't manage it. */
let artistRow: { id: string; drive_folder_id: string | null } | null = null
/** Already-imported drive_file_ids, per table. */
let imported: Record<string, string[]> = {}
/** Every `update()` the action reached, so a guard can be proven to run first. */
const writes: { table: string; patch: Record<string, unknown> }[] = []

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    from: (table: string) => ({
      select: () => {
        const result =
          table === 'artists'
            ? { data: artistRow, error: null }
            : { data: (imported[table] ?? []).map((id) => ({ drive_file_id: id })), error: null }
        const leaf = {
          single: async () => result,
          maybeSingle: async () => result,
          // `.not()` ends the chain in listDriveFilesAction and is awaited directly.
          not: () => Promise.resolve(result),
        }
        return { eq: () => leaf }
      },
      update: (patch: Record<string, unknown>) => ({
        eq: async () => {
          writes.push({ table, patch })
          return { error: null }
        },
      }),
    }),
  })),
}))

const drive = vi.hoisted(() => ({
  getFolder: vi.fn(),
  listMediaFiles: vi.fn(),
  listAllMediaFiles: vi.fn(),
  getFileMeta: vi.fn(),
  downloadFile: vi.fn(),
}))

vi.mock('@/lib/drive', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/drive')>()),
  createDriveClient: vi.fn(() => drive),
}))

vi.mock('@/lib/drive-import', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/drive-import')>()),
  importDriveFile: vi.fn(async () => ({ ok: true })),
}))

const mockedImport = vi.mocked(importDriveFile)
const mockedCreateClient = vi.mocked(createClient)
const load = () => import('@/app/artists/[id]/(dashboard)/actions')

const file = (id: string, name: string): DriveFile => ({
  id,
  name,
  mimeType: 'audio/mpeg',
  kind: 'audio',
  size: 1024,
  thumbnailUrl: null,
})

beforeEach(() => {
  artistRow = { id: ARTIST, drive_folder_id: FOLDER }
  imported = {}
  writes.length = 0
  drive.getFolder.mockResolvedValue({ id: FOLDER, name: 'Artist Media' })
  drive.listMediaFiles.mockResolvedValue({ files: [file('f1', 'One.mp3')], nextPageToken: null })
  drive.listAllMediaFiles.mockResolvedValue([file('f1', 'One.mp3'), file('f2', 'Two.mp3')])
  mockedImport.mockResolvedValue({ ok: true })
})

const fd = (v: string) => {
  const f = new FormData()
  f.set('drive_folder_id', v)
  return f
}

describe('saveDriveFolderAction', () => {
  it('stores the bare id from a pasted share link', async () => {
    const { saveDriveFolderAction } = await load()
    const res = await saveDriveFolderAction(
      ARTIST,
      fd(`https://drive.google.com/drive/folders/${FOLDER}?usp=sharing`),
    )
    expect(res.error).toBeUndefined()
    // The LINK must never reach the column: it is later interpolated into the
    // files.list `q` string, where a quote would break out of it.
    expect(writes).toEqual([{ table: 'artists', patch: { drive_folder_id: FOLDER } }])
  })

  it('accepts a bare folder id unchanged', async () => {
    const { saveDriveFolderAction } = await load()
    expect((await saveDriveFolderAction(ARTIST, fd(FOLDER))).error).toBeUndefined()
    expect(writes).toEqual([{ table: 'artists', patch: { drive_folder_id: FOLDER } }])
  })

  it('CRITICAL: rejects a value that is not a Drive folder link, and never writes', async () => {
    const { saveDriveFolderAction } = await load()
    for (const bad of ['https://evil.example.com/folders/x', "abc' or '1'='1", 'https://drive.google.com/', 'short']) {
      expect((await saveDriveFolderAction(ARTIST, fd(bad))).error).toBe(
        "That doesn't look like a Google Drive folder link.",
      )
    }
    expect(writes).toEqual([])
  })

  it('a blank value clears the link (writes NULL, not the empty string)', async () => {
    const { saveDriveFolderAction } = await load()
    expect((await saveDriveFolderAction(ARTIST, fd('   '))).error).toBeUndefined()
    expect(writes).toEqual([{ table: 'artists', patch: { drive_folder_id: null } }])
  })

  it('CRITICAL: a caller who does not manage the artist gets a real error, not silent success', async () => {
    // RLS already blocks the write, but a row-filtered UPDATE matches zero rows and
    // returns no error — so without an ownership read the action answers `{}` and an
    // authorization failure is indistinguishable from a save. See _owns.ts.
    artistRow = null
    const { saveDriveFolderAction } = await load()
    expect((await saveDriveFolderAction(ARTIST, fd(FOLDER))).error).toBe('Artist not found.')
  })
})

describe('checkDriveFolderAction', () => {
  it('reports how much media the folder holds', async () => {
    const { checkDriveFolderAction } = await load()
    expect(await checkDriveFolderAction(ARTIST)).toEqual({ ok: true, message: 'Found 2 media files.' })
    expect(drive.listAllMediaFiles).toHaveBeenCalledWith(FOLDER, 'all')
  })

  it('says "1 media file" for a single hit', async () => {
    drive.listAllMediaFiles.mockResolvedValue([file('f1', 'One.mp3')])
    const { checkDriveFolderAction } = await load()
    expect((await checkDriveFolderAction(ARTIST)).message).toBe('Found 1 media file.')
  })

  it('steers the manager to Integrations when no folder is linked', async () => {
    artistRow = { id: ARTIST, drive_folder_id: null }
    const { checkDriveFolderAction } = await load()
    const res = await checkDriveFolderAction(ARTIST)
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/No Drive folder linked yet/)
    expect(drive.getFolder).not.toHaveBeenCalled()
  })

  it('surfaces the not-shared error instead of a silent empty count', async () => {
    // files.list on a PRIVATE folder returns 200 + [] — reporting "Found 0 files"
    // there would tell the manager their folder is empty when it is unreachable.
    drive.getFolder.mockRejectedValue(new Error(FOLDER_NOT_SHARED))
    const { checkDriveFolderAction } = await load()
    expect(await checkDriveFolderAction(ARTIST)).toEqual({ ok: false, error: FOLDER_NOT_SHARED })
  })

  it('CRITICAL: a caller who does not manage the artist gets nothing and no API call', async () => {
    artistRow = null
    const { checkDriveFolderAction } = await load()
    expect(await checkDriveFolderAction(ARTIST)).toEqual({ ok: false, error: 'Artist not found.' })
    expect(drive.getFolder).not.toHaveBeenCalled()
  })
})

describe('listDriveFilesAction', () => {
  it('returns the page plus which files are already imported', async () => {
    imported = { tracks: ['f1'] }
    const { listDriveFilesAction } = await load()
    const res = await listDriveFilesAction(ARTIST, 'audio', null)
    expect(res).toEqual({
      ok: true,
      files: [file('f1', 'One.mp3')],
      nextPageToken: null,
      imported: ['f1'],
    })
    expect(drive.listMediaFiles).toHaveBeenCalledWith(FOLDER, 'audio', null)
  })

  it('passes the page token through so pagination advances', async () => {
    drive.listMediaFiles.mockResolvedValue({ files: [], nextPageToken: 'tok2' })
    const { listDriveFilesAction } = await load()
    const res = await listDriveFilesAction(ARTIST, 'image', 'tok1')
    expect(drive.listMediaFiles).toHaveBeenCalledWith(FOLDER, 'image', 'tok1')
    expect(res).toMatchObject({ ok: true, nextPageToken: 'tok2' })
  })

  it('reads the imported set from the table that owns each kind', async () => {
    // Wrong table here = every file shows as un-imported, so the manager
    // re-imports duplicates (the dedupe index then rejects them one by one).
    imported = { tracks: ['audio-1'], videos: ['video-1'], media: ['image-1'] }
    const { listDriveFilesAction } = await load()
    for (const [kind, id] of [['audio', 'audio-1'], ['video', 'video-1'], ['image', 'image-1']] as const) {
      const res = await listDriveFilesAction(ARTIST, kind, null)
      expect(res).toMatchObject({ ok: true, imported: [id] })
    }
  })

  it('checks the folder is reachable before listing (no silent empty page)', async () => {
    drive.getFolder.mockRejectedValue(new Error(FOLDER_NOT_SHARED))
    const { listDriveFilesAction } = await load()
    expect(await listDriveFilesAction(ARTIST, 'audio', null)).toEqual({ ok: false, error: FOLDER_NOT_SHARED })
    expect(drive.listMediaFiles).not.toHaveBeenCalled()
  })

  it('CRITICAL: a caller who does not manage the artist gets nothing and no API call', async () => {
    artistRow = null
    const { listDriveFilesAction } = await load()
    expect(await listDriveFilesAction(ARTIST, 'audio', null)).toEqual({ ok: false, error: 'Artist not found.' })
    expect(drive.getFolder).not.toHaveBeenCalled()
  })
})

describe('importDriveFileAction', () => {
  it('imports the file inside the connected folder', async () => {
    const { importDriveFileAction } = await load()
    expect(await importDriveFileAction(ARTIST, 'audio', 'f1')).toEqual({ ok: true })
    expect(mockedImport).toHaveBeenCalledWith(expect.anything(), drive, {
      artistId: ARTIST,
      kind: 'audio',
      fileId: 'f1',
      // Server-side, from the artist row — never from the client, or the parents
      // check in importDriveFile would be checking against an attacker's folder.
      folderId: FOLDER,
    })
  })

  it('CRITICAL: rejects a fileId outside the Drive id charset before touching anything', async () => {
    const { importDriveFileAction } = await load()
    // Each of these rewrites the URL `getFileMeta` builds: an extra query param, a
    // path escape, or a whole different host path — with our API key attached.
    for (const bad of [
      'f1?alt=media&key=leak',
      '../../../drive/v3/files',
      'f1/../../oauth2/token',
      "f1' or '1'='1",
      'f1 f2',
      'f1%2F..',
      '',
      'f1#frag',
    ]) {
      expect(await importDriveFileAction(ARTIST, 'audio', bad)).toEqual({
        ok: false,
        error: 'Invalid Drive file id.',
      })
    }
    // Load-bearing: the guard has to run before the fetch AND before the DB read, or
    // it is only cosmetic — a validate-after-work refactor would still pass above.
    expect(mockedImport).not.toHaveBeenCalled()
    expect(mockedCreateClient).not.toHaveBeenCalled()
  })

  it('accepts the real Drive id charset (letters, digits, _ and -)', async () => {
    const { importDriveFileAction } = await load()
    expect(await importDriveFileAction(ARTIST, 'audio', '1a-B_c9XyZ')).toEqual({ ok: true })
  })

  it('surfaces the import failure verbatim (wrong kind, not in folder, too big…)', async () => {
    mockedImport.mockResolvedValue({ error: "That file isn't an image." })
    const { importDriveFileAction } = await load()
    expect(await importDriveFileAction(ARTIST, 'image', 'f1')).toEqual({
      ok: false,
      error: "That file isn't an image.",
    })
  })

  it('turns a thrown Drive/network error into a message instead of a 500', async () => {
    mockedImport.mockRejectedValue(new Error('Google Drive API error 500'))
    const { importDriveFileAction } = await load()
    expect(await importDriveFileAction(ARTIST, 'audio', 'f1')).toEqual({
      ok: false,
      error: 'Google Drive API error 500',
    })
  })

  it('CRITICAL: a caller who does not manage the artist gets nothing and never imports', async () => {
    artistRow = null
    const { importDriveFileAction } = await load()
    expect(await importDriveFileAction(ARTIST, 'audio', 'f1')).toEqual({ ok: false, error: 'Artist not found.' })
    expect(mockedImport).not.toHaveBeenCalled()
  })
})
