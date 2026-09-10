// Reading enquiry attachments, where the interesting part is a file that is gone or never
//   arrived.
/**
 * Reading attachments in the dashboard.
 *
 * The interesting behaviour is all about ABSENCE. Files are deleted after 90 days while
 * the enquiry is kept, and a row can also exist with no object at all (it is written when
 * the upload ticket is minted, not when the bytes arrive). So "no file" is the normal end
 * state, and the page has to say so rather than break or show a dead player.
 */
import { describe, expect, it, vi } from 'vitest'
import { fileSize, toPlayable, type AttachmentRow } from '@/lib/enquiry-attachments'
import { createClient } from '@/lib/supabase/server'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

const row = (over: Partial<AttachmentRow> = {}): AttachmentRow => ({
  id: 'r1',
  enquiry_id: 'e1',
  storage_path: 'a/e/one.mp3',
  filename: 'one.mp3',
  mime_type: 'audio/mpeg',
  bytes: 999, // DECLARED by the sender — never trusted
  created_at: '2026-08-03T12:00:00Z',
  expired_at: null,
  ...over,
})

/** A client whose signing and listing can each be made to succeed or fail. */
const client = (signed: string | null, listed: { name: string; metadata?: { size?: number } }[] = []) =>
  ({
    storage: {
      from: () => ({
        createSignedUrl: vi.fn(async () => ({ data: signed ? { signedUrl: signed } : null })),
        list: vi.fn(async () => ({ data: listed })),
      }),
    },
  }) as never

describe('toPlayable', () => {
  it('signs a live file', async () => {
    const [a] = await toPlayable(client('https://signed.example/one.mp3'), [row()])
    expect(a.url).toBe('https://signed.example/one.mp3')
    expect(a.expired).toBe(false)
    expect(a.neverUploaded).toBe(false)
  })

  it('CRITICAL: reports the REAL size from storage, not the sender-declared one', async () => {
    // The row says 999. Someone can declare 1 byte and upload 25MB, so a number the
    // manager reads must come from the object itself.
    const [a] = await toPlayable(
      client('https://signed.example/one.mp3', [{ name: 'one.mp3', metadata: { size: 4210233 } }]),
      [row({ bytes: 999 })],
    )
    expect(a.bytes).toBe(4210233)
  })

  it('reports null rather than the declared size when storage has no metadata', async () => {
    const [a] = await toPlayable(client('https://signed.example/one.mp3', []), [row({ bytes: 999 })])
    expect(a.bytes).toBeNull()
  })

  it('CRITICAL: an EXPIRED attachment keeps its identity so the page can say so', async () => {
    // The sweep tombstones: object gone, storage_path nulled, expired_at stamped. If the
    // row were deleted instead there would be nothing left to render and the attachment
    // would silently vanish — the bug skeen found in the first version.
    const [a] = await toPlayable(client(null), [
      row({ storage_path: null, expired_at: '2026-08-01T00:00:00Z' }),
    ])
    expect(a.expired).toBe(true)
    expect(a.neverUploaded).toBe(false)
    expect(a.filename).toBe('one.mp3')
    expect(a.url).toBeNull()
  })

  it('CRITICAL: never-uploaded is a DIFFERENT state from expired', async () => {
    // A ticket was minted and nothing arrived. Collapsing this into "expired" tells the
    // manager a file aged out when in fact the sender never sent one — different facts,
    // and only one is worth chasing someone about.
    const [a] = await toPlayable(client(null), [row()])
    expect(a.neverUploaded).toBe(true)
    expect(a.expired).toBe(false)
  })

  it('does not try to sign a tombstoned row', async () => {
    const c = client('https://x')
    const spy = c as unknown as { storage: { from: () => { createSignedUrl: ReturnType<typeof vi.fn> } } }
    await toPlayable(c, [row({ storage_path: null, expired_at: '2026-08-01T00:00:00Z' })])
    expect(spy.storage.from().createSignedUrl).not.toHaveBeenCalled()
  })

  it('handles an empty list', async () => {
    expect(await toPlayable(client(null), [])).toEqual([])
  })
})

describe('signEnquiryAttachmentsAction — the columns it reads', () => {
  it('CRITICAL: selects expired_at, or the expired branch above is unreachable', async () => {
    // AttachmentRow requires expired_at; the cast in the action would hide a select that
    // drops it, and every expired attachment would render as "never uploaded" instead.
    let selected = ''
    vi.mocked(createClient).mockResolvedValue({
      from: () => ({
        select: (cols: string) => {
          selected = cols
          return { eq: () => ({ order: async () => ({ data: [] }) }) }
        },
      }),
    } as never)
    const { signEnquiryAttachmentsAction } = await import(
      '@/app/artists/[id]/(dashboard)/enquiries/actions'
    )
    await signEnquiryAttachmentsAction('e1')
    expect(selected.split(',').map((c) => c.trim())).toContain('expired_at')
  })
})

describe('fileSize', () => {
  it('formats bytes, KB and MB', () => {
    expect(fileSize(800)).toBe('800 B')
    expect(fileSize(4096)).toBe('4 KB')
    expect(fileSize(4210233)).toBe('4.0 MB')
  })

  it('renders nothing when the size is unknown', () => {
    expect(fileSize(null)).toBe('')
    expect(fileSize(0)).toBe('')
  })
})
