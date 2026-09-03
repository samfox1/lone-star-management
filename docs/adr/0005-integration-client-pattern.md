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
  refreshes rows it owns (`source = provider`), and skips rows owned by anyone
  else. ~~never clobbers a manual edit (a human touching a row flips `source` to
  `manual`)~~ — **corrected 2026-09-02: that flip was never implemented.** A row
  imported from a provider keeps that source forever, so every pull refreshes it,
  hand edits included; only a row that was manually ADDED (or owned by another
  provider) is protected. A sync must therefore not write any column a manager can
  edit. It is
  partial-tolerant — a bad upstream row is reported in the result (`failed`,
  `errors`), never a half-written silent state — but an RLS/permission denial
  (Postgres `42501`) is fatal (preserves tenant isolation).
- ~~Per the user decision: an artist picks **one** track-catalog source (Spotify
  *or* Apple), so there is no cross-source merge / ISRC dedup.~~
  **Superseded 2026-07-09:** the union model landed — a track carries per-platform
  ids/links (`spotify_id`, `apple_id`/`apple_url`, `deezer_id`, `soundcloud_url`)
  from several services at once, so there IS a merge (keyed by the track row, not
  by ISRC). See `src/lib/music.ts` `trackPlatforms` and the Released/Unreleased
  derivation (a candidate ADR-0006 if this needs its own record).

## Consequences

- Every client follows the same shape, so a new one is a small, well-tested
  addition. New providers need a `*.source` CHECK-constraint value.
- **Shared GET-with-retry (added at 7 clients).** The 429 / Retry-After backoff
  loop is now in one place — `src/lib/http.ts` `httpGetJson(url, {fetchImpl,
  sleep, maxRetries, provider, headers?, onBody?})`. Per-client quirks
  parameterize: `headers` (a thunk, so token clients — Spotify/Apple — refresh
  per attempt), `onBody` (Deezer's in-body quota code 4 → retry). Each GET client
  is now URL-build + auth + map. Shopify (GraphQL POST) keeps its own request
  path. This removed the copy-paste that had already let a NaN-`Retry-After` guard
  drift out of the two oldest clients (Spotify/Bandsintown).
- The sync result is structured so a future UI can show "imported X, Y failed."
- Compliance gates live outside the code (e.g. Bandsintown's terms/app_id — see
  `TODO.md`); the client being built ≠ cleared to run in production.
