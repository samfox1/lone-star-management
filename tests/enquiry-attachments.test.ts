/**
 * Reading attachments in the dashboard.
 *
 * The interesting behaviour is all about ABSENCE. Files are deleted after 90 days while
 * the enquiry is kept, and a row can also exist with no object at all (it is written when
 * the upload ticket is minted, not when the bytes arrive). So "no file" is the normal end
 * state, and the page has to say so rather than break or show a dead player.
 */
import { describe, expect, it, vi } from 'vitest'
import { fileSize, isExpired, toPlayable, type AttachmentRow } from '@/lib/enquiry-attachments'

const NOW = Date.parse('2026-08-04T12:00:00Z')
const ago = (days: number) => new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString()

const row = (over: Partial<AttachmentRow> = {}): AttachmentRow => ({
  id: 'r1',
  enquiry_id: 'e1',
  storage_path: 'a/e/one.mp3',
  filename: 'one.mp3',
  mime_type: 'audio/mpeg',
  bytes: 4210233,
  created_at: ago(1),
  ...over,
})

/** A client whose signing can be made to succeed or fail per call. */
const client = (signed: string | null) =>
  ({
    storage: {
      from: () => ({
        createSignedUrl: vi.fn(async () => ({ data: signed ? { signedUrl: signed } : null })),
      }),
    },
  }) as never

describe('isExpired', () => {
  it('is false inside the window and true past it', () => {
    expect(isExpired(ago(89), NOW)).toBe(false)
    expect(isExpired(ago(91), NOW)).toBe(true)
  })

  it('CRITICAL: a fresh upload is never treated as expired', () => {
    // A sign error here would read as "expired" for a file uploaded seconds ago.
    expect(isExpired(new Date(NOW).toISOString(), NOW)).toBe(false)
  })
})

describe('toPlayable', () => {
  it('signs a live file', async () => {
    const [a] = await toPlayable(client('https://signed.example/one.mp3'), [row()], NOW)
    expect(a.url).toBe('https://signed.example/one.mp3')
    expect(a.expired).toBe(false)
  })

  it('CRITICAL: does not even try to sign a file past retention', async () => {
    // The object is gone; asking costs a round trip per row to learn what the timestamp
    // already says.
    const c = client('https://signed.example/x')
    const spy = c as unknown as { storage: { from: () => { createSignedUrl: ReturnType<typeof vi.fn> } } }
    const [a] = await toPlayable(c, [row({ created_at: ago(120) })], NOW)
    expect(a.expired).toBe(true)
    expect(a.url).toBeNull()
    expect(spy.storage.from().createSignedUrl).not.toHaveBeenCalled()
  })

  it('CRITICAL: a row whose object never arrived reads as expired, not as an error', async () => {
    // An abandoned upload: the row is written when the ticket is minted. To the manager
    // this is the same fact as an expired file — the audio is not there — and a second
    // error state would be a distinction they cannot act on.
    const [a] = await toPlayable(client(null), [row()], NOW)
    expect(a.expired).toBe(true)
    expect(a.url).toBeNull()
  })

  it('keeps the filename and type even when the file is gone', async () => {
    // The manager should still see WHAT expired, not a blank row.
    const [a] = await toPlayable(client(null), [row({ filename: 'demo.wav' })], NOW)
    expect(a.filename).toBe('demo.wav')
    expect(a.mime_type).toBe('audio/mpeg')
  })

  it('handles an empty list', async () => {
    expect(await toPlayable(client(null), [], NOW)).toEqual([])
  })
})

describe('fileSize', () => {
  it('formats bytes, KB and MB', () => {
    expect(fileSize(800)).toBe('800 B')
    expect(fileSize(4096)).toBe('4 KB')
    expect(fileSize(4210233)).toBe('4.0 MB')
  })

  it('renders nothing rather than "0 B" when the sender declared no size', () => {
    // `bytes` is client-declared and advisory, so absent is common and not worth showing.
    expect(fileSize(0)).toBe('')
    expect(fileSize(-1)).toBe('')
  })
})
