// @vitest-environment jsdom
/**
 * The pause/play toggle (2026-08-11): setVideosPlaying pauses every PLAYING <video>
 * and resumes only what IT paused — a clip the fan paused themselves must not spring
 * back to life. Embeds get best-effort postMessage commands. Plus the cursor's
 * anti-flash rule from the same review: an identical re-apply keeps the mount.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setVideosPlaying } from '@samfox1/site-bridge/playback'
import { applyCursor, type CursorSettings } from '@samfox1/site-bridge/cursor'
import { BRIDGE_VERSION, EDITOR_SOURCE, mountFrameBridge } from '@samfox1/site-bridge'

const NONE: CursorSettings = { image: '', clickImage: '', trail: '', trailColor: '' }

afterEach(() => {
  applyCursor(document, NONE)
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

/** jsdom media elements don't actually play; give one a controllable paused state. */
function fakeVideo(playing: boolean): HTMLVideoElement & { play: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn> } {
  const v = document.createElement('video')
  let paused = !playing
  Object.defineProperty(v, 'paused', { get: () => paused, configurable: true })
  Object.defineProperty(v, 'pause', { value: vi.fn(() => { paused = true }), configurable: true })
  Object.defineProperty(v, 'play', { value: vi.fn(async () => { paused = false }), configurable: true })
  document.body.appendChild(v)
  return v as ReturnType<typeof fakeVideo>
}

describe('setVideosPlaying', () => {
  it('CRITICAL: pause stops playing videos; resume revives ONLY those', () => {
    const playing = fakeVideo(true)
    const fanPaused = fakeVideo(false) // the fan's own pause — not ours to undo
    setVideosPlaying(document, false)
    expect(playing.pause).toHaveBeenCalled()
    expect(fanPaused.pause).not.toHaveBeenCalled()
    setVideosPlaying(document, true)
    expect(playing.play).toHaveBeenCalled()
    expect(fanPaused.play).not.toHaveBeenCalled()
  })

  it('sends the YouTube command to a YouTube iframe, nothing to others', () => {
    const yt = document.createElement('iframe')
    yt.src = 'https://www.youtube.com/embed/abc123'
    const other = document.createElement('iframe')
    other.src = 'https://example.com/widget'
    document.body.append(yt, other)
    const ytPost = vi.spyOn(yt.contentWindow!, 'postMessage')
    const otherPost = vi.spyOn(other.contentWindow!, 'postMessage')
    setVideosPlaying(document, false)
    expect(ytPost).toHaveBeenCalledWith(expect.stringContaining('pauseVideo'), '*')
    expect(otherPost).not.toHaveBeenCalled()
  })

  it('the frame routes set-playback to the videos', () => {
    const v = fakeVideo(true)
    const stop = mountFrameBridge({
      editorOrigin: 'https://editor.test',
      onInitData: () => {},
      editList: { fields: [], slots: [], styles: [], links: [] },
      target: { postMessage: () => {} } as unknown as Window,
    })
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://editor.test',
        data: { v: BRIDGE_VERSION, source: EDITOR_SOURCE, type: 'set-playback', playing: false },
      }),
    )
    expect(v.pause).toHaveBeenCalled()
    stop()
  })
})

describe('applyCursor — identical re-apply keeps the mount (the flash fix)', () => {
  it('CRITICAL: same settings → same trail layer; changed settings → replaced', () => {
    // Every editor save triggers an init-data refresh; each one re-applied the cursor
    // and the teardown/remount read as flashing (Sam, 2026-08-11).
    const dots: CursorSettings = { ...NONE, trail: 'dots' }
    applyCursor(document, dots)
    const layer = document.querySelector('[data-lse-cursor-trail]')
    applyCursor(document, { ...dots }) // equal by VALUE, not identity
    expect(document.querySelector('[data-lse-cursor-trail]')).toBe(layer)
    applyCursor(document, { ...NONE, trail: 'sparkles' })
    expect(document.querySelector('[data-lse-cursor-trail]')).not.toBe(layer)
  })

  it('a real teardown clears the memo — the next identical apply mounts again', () => {
    const dots: CursorSettings = { ...NONE, trail: 'dots' }
    const stop = applyCursor(document, dots)
    stop()
    applyCursor(document, dots)
    expect(document.querySelector('[data-lse-cursor-trail="dots"]')).not.toBeNull()
  })
})
