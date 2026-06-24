# 0005 — Factory integration clients + source-conflict sync policy

Status: Accepted

## Context

Content can be pulled from external services (Spotify, Bandsintown, Shopify, and
planned Apple/Ticketmaster/YouTube). These pulls must be testable without real
credentials or network, and must never overwrite a manager's hand edits.

## Decision

- Each integration is a **factory client** (`createSpotifyClient`, etc.) with
  injectable `fetch` and `sleep`, owning auth, 429 backoff/retry, pagination, and
  error shaping. Routes/sync jobs call the client, never raw `fetch`. This makes
  every client fully testable at the fetch boundary (mock `fetch`, no creds).
- Read-only public-catalog APIs use **global app credentials** in env (like
  Spotify's client-credentials). Per-store private creds (Shopify) are
  per-artist in Vault (ADR 0001).
- **Sync conflict policy**: a generic `syncExternal` core inserts new rows,
  refreshes rows it owns (`source = provider`), and **never clobbers a manual
  edit** (a human touching a row flips `source` to `manual`). It is
  partial-tolerant — a bad upstream row is reported in the result (`failed`,
  `errors`), never a half-written silent state — but an RLS/permission denial
  (Postgres `42501`) is fatal (preserves tenant isolation).
- Per the user decision: an artist picks **one** track-catalog source (Spotify
  *or* Apple), so there is no cross-source merge / ISRC dedup. Deezer/SoundCloud
  are metadata/link-out only (their APIs can't back a playable player).

## Consequences

- Every client follows the same shape, so a new one is a small, well-tested
  addition. New providers need a `*.source` CHECK-constraint value.
- The sync result is structured so a future UI can show "imported X, Y failed."
- Compliance gates live outside the code (e.g. Bandsintown's terms/app_id — see
  `TODO.md`); the client being built ≠ cleared to run in production.
