// @vitest-environment jsdom
// Browsing the connected Drive folder and importing files one at a time.
/**
 * DriveBrowser — browse the connected Drive folder, multi-select, copy-import.
 * Actions are mocked; locks: listing renders names/sizes, Imported files are
 * badged + unselectable, imports run SEQUENTIALLY per selected id, a per-file
 * failure stays inline while others succeed, Load more appends the next page,
 * and a list error renders as the panel body.
 */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { DriveBrowser, type DriveListResult } from '@/app/artists/[id]/(dashboard)/drive-browser'
import { Toaster } from '@/app/artists/[id]/(dashboard)/toast'
import type { DriveFile } from '@/lib/drive'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const file = (over: Partial<DriveFile>): DriveFile => ({
  id: 'f', name: 'f.mp3', mimeType: 'audio/mpeg', kind: 'audio', size: 2 * 1024 * 1024, thumbnailUrl: null, ...over,
})

const PAGE1: DriveListResult = {
  ok: true,
  files: [
    file({ id: 'a1', name: 'Demo One.mp3' }),
    file({ id: 'a2', name: 'Demo Two.mp3' }),
    file({ id: 'a3', name: 'Old Import.mp3' }),
  ],
  nextPageToken: null,
  imported: ['a3'],
}

function setup(list: DriveListResult = PAGE1, importAction = vi.fn(async (_id: string) => ({ ok: true }))) {
  const listAction = vi.fn(async (_t?: string | null) => list)
  render(
    <>
      <DriveBrowser kind="audio" listAction={listAction} importAction={importAction} />
      <Toaster />
    </>,
  )
  return { listAction, importAction }
}

describe('DriveBrowser', () => {
  it('lists the folder with names, sizes, and an Imported badge', async () => {
    setup()
    expect(await screen.findByText('Demo One.mp3')).toBeInTheDocument()
    expect(screen.getAllByText('2 MB')).toHaveLength(3)
    expect(screen.getByText('Imported')).toBeInTheDocument()
    expect(screen.getByLabelText('Old Import.mp3')).toBeDisabled() // can't reselect
  })

  it('imports the selection sequentially and refreshes', async () => {
    const order: string[] = []
    const importAction = vi.fn(async (id: string) => {
      order.push(id)
      return { ok: true }
    })
    setup(PAGE1, importAction)
    fireEvent.click(await screen.findByLabelText('Demo One.mp3'))
    fireEvent.click(screen.getByLabelText('Demo Two.mp3'))
    fireEvent.click(screen.getByRole('button', { name: /Import 2 songs/ }))

    expect(await screen.findByText('Imported 2 songs')).toBeInTheDocument()
    expect(order).toEqual(['a1', 'a2'])
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(screen.getAllByText('Imported').length).toBe(3) // both newly badged + the old one
  })

  // The recorded order alone can't tell sequential from parallel: Promise.all over
  // the same ids records the same list. Hold the first import open and assert the
  // second has not started — the server action buffers a whole file in memory, so
  // two at once is two files' bytes resident at the same time.
  it('does not start the next import until the previous one resolves', async () => {
    const started: string[] = []
    let releaseFirst = () => {}
    const firstDone = new Promise<void>((r) => {
      releaseFirst = r
    })
    const importAction = vi.fn(async (id: string) => {
      started.push(id)
      if (id === 'a1') await firstDone
      return { ok: true }
    })
    setup(PAGE1, importAction)
    fireEvent.click(await screen.findByLabelText('Demo One.mp3'))
    fireEvent.click(screen.getByLabelText('Demo Two.mp3'))
    fireEvent.click(screen.getByRole('button', { name: /Import 2 songs/ }))

    await waitFor(() => expect(started).toEqual(['a1'])) // a2 is still queued behind a1

    releaseFirst()
    expect(await screen.findByText('Imported 2 songs')).toBeInTheDocument()
    expect(started).toEqual(['a1', 'a2'])
  })

  it('imports in list order, not the order the boxes were ticked', async () => {
    const order: string[] = []
    const importAction = vi.fn(async (id: string) => {
      order.push(id)
      return { ok: true }
    })
    setup(PAGE1, importAction)
    fireEvent.click(await screen.findByLabelText('Demo Two.mp3')) // ticked FIRST
    fireEvent.click(screen.getByLabelText('Demo One.mp3'))
    fireEvent.click(screen.getByRole('button', { name: /Import 2 songs/ }))

    expect(await screen.findByText('Imported 2 songs')).toBeInTheDocument()
    expect(order).toEqual(['a1', 'a2']) // the order the manager sees on screen
  })

  it('keeps a per-file failure inline while the rest succeed', async () => {
    const importAction = vi.fn(async (id: string) =>
      id === 'a1' ? { ok: false, error: 'Already imported from Drive.' } : { ok: true },
    )
    setup(PAGE1, importAction)
    fireEvent.click(await screen.findByLabelText('Demo One.mp3'))
    fireEvent.click(screen.getByLabelText('Demo Two.mp3'))
    fireEvent.click(screen.getByRole('button', { name: /Import 2 songs/ }))

    expect(await screen.findByText('Imported 1 of 2 — 1 failed')).toBeInTheDocument()
    expect(screen.getByText('Already imported from Drive.')).toBeInTheDocument()
    expect(refresh).toHaveBeenCalledTimes(1) // one success still refreshes
  })

  it('appends the next page via Load more', async () => {
    const listAction = vi
      .fn<(t?: string | null) => Promise<DriveListResult>>()
      .mockResolvedValueOnce({ ok: true, files: [file({ id: 'a1', name: 'One.mp3' })], nextPageToken: 't2', imported: [] })
      .mockResolvedValueOnce({ ok: true, files: [file({ id: 'a2', name: 'Two.mp3' })], nextPageToken: null, imported: [] })
    render(<DriveBrowser kind="audio" listAction={listAction} importAction={vi.fn(async () => ({ ok: true }))} />)

    fireEvent.click(await screen.findByText('Load more'))
    expect(await screen.findByText('Two.mp3')).toBeInTheDocument()
    expect(screen.getByText('One.mp3')).toBeInTheDocument() // appended, not replaced
    expect(listAction).toHaveBeenLastCalledWith('t2')
    await waitFor(() => expect(screen.queryByText('Load more')).not.toBeInTheDocument())
  })

  it('renders a list error (e.g. folder not linked) as the panel body', async () => {
    setup({ ok: false, error: 'No Drive folder linked yet — connect one under Manager tools → Integrations.' })
    expect(await screen.findByText(/No Drive folder linked yet/)).toBeInTheDocument()
  })
})
