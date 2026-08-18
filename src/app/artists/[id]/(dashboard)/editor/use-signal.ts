import { useState } from 'react'

/**
 * The editor's SIGNAL pattern, extracted (2026-08-18 consolidation).
 *
 * A frame click is a GESTURE, not a value: clicking the same element twice is two
 * events, so every select channel rides a `{ …, nonce }` whose nonce ticks per click
 * (`bumpNonce`), and every consumer latches on the NONCE, never the payload
 * (`useSignal`). Both halves were hand-rolled ~10 times before this file, and the
 * consumer half was mis-written twice — the Listen button (2026-08-17) and the style
 * channel (2026-08-18) both compared payloads, so a repeat click never re-fired.
 *
 * `useSignal` runs the handler DURING RENDER (the repo's sanctioned "reset state on
 * prop change" pattern): React re-runs the component before painting, which is exactly
 * how a routed select can switch panels without flashing the stale one. Handlers must
 * therefore only call state setters, never perform side effects.
 */

/** Tick a channel's nonce: `set((prev) => bumpNonce(prev, { key }))`. */
export function bumpNonce<T extends object>(
  prev: (T & { nonce: number }) | null,
  next: T,
): T & { nonce: number } {
  return { ...next, nonce: (prev?.nonce ?? 0) + 1 }
}

/**
 * Latch a nonce-carrying signal: `fire` runs once per DISTINCT nonce, during render.
 *
 * Returning `false` from `fire` leaves the signal UNCONSUMED — it retries every render
 * until something handles it. The region channel depends on this: a select that lands
 * before its panel's data resolves (a text-field click racing the fields fetch) must
 * wait, not vanish. Return nothing (or true) to consume.
 */
export function useSignal<T extends { nonce: number }>(
  signal: T | null | undefined,
  fire: (signal: T) => boolean | void,
): void {
  const [seen, setSeen] = useState(0)
  if (signal && signal.nonce !== seen) {
    if (fire(signal) !== false) setSeen(signal.nonce)
  }
}
