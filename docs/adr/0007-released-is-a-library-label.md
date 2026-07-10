# 0007 — Released/Unreleased is a library label, not a site gate

Status: Accepted (shipped 2026-07-10, migration `20260710170000`)

## Context

The 2026-07-08/09 music restructure made Released vs Unreleased a derived bucket
(platform presence OR a stored `released` flag) and gated the **public site** on it
— `get_public_site`'s tracks branch and `audio_path_for_play` served Released music
only (migrations `20260709120000` / `...150000` / `...160000`).

The visual site editor (ADR 0006) needs per-item, manager-controlled placement of
tracks on the site. Deriving site presence from Released conflated two different
things — *how the artist organizes their catalog* and *what's on their site* — and
left no per-track on/off control, which the editor's placement model requires.

## Decision

- **Released/Unreleased is purely a LIBRARY organizing label** now (the dashboard
  Music tab). It has **no effect on the public site**.
- **The public site gates tracks on their own `tracks.visible` flag**, uniform with
  merch / videos / tour (the visible-gated types of ADR 0002). This woke the dormant
  `tracks.visible` column. `get_public_site`'s tracks branch, `audio_path_for_play`,
  and the `getWorkingSite` preview all gate on `visible`.
- **Cutover backfill:** a one-time `UPDATE` set `tracks.visible` = each track's prior
  public status (Released-derived, widen-only, AND its release visible) so the live
  site was unchanged at the switch.
- **The release doors stay Released-gated for now.** `get_release` /
  `get_public_releases` are a separate smart-link / EPK surface and continue to gate
  on Released + visible. `lib/music.ts`'s derivation and the `music_track_on_platform`
  / `music_release_is_released` SQL helpers remain — they power the library buckets.

## Consequences

- Supersedes the **site-gating** half of the Released-only door work for the tracks
  branch (`20260709120000` / `...150000` / `...160000`); those helpers now serve the
  library only, not the public tracks list.
- Tracks join every other content type on the uniform `visible` placement model the
  editor needs.
- Release and track site-visibility are now **independent** — hiding a release no
  longer auto-hides its tracks on the flat public tracks list; each is toggled on
  its own.
- `links.visible` remains dormant (no UI to set it yet) — a follow-up.
- A later phase may unify release/track placement (ADR 0006's editor), at which
  point the release doors' Released gate is revisited.
