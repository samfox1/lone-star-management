# 0003 — Separate CRUD and Publishable entity registries

Status: Accepted

## Context

A single config registry (`ENTITIES`) drove both the manager CRUD forms and the
publish/version layer for the content types. Adding `media` — which is published
but edited through its own uploader, not the generic forms — forced it into that
registry with empty `fields`/`required`, and a `CrudEntity = Exclude<EntityType,
'media'>` workaround so the CRUD code wouldn't see it. Two different concerns were
conflated in one type and one map.

## Decision

Split them into two first-class registries in `src/lib/content.ts`:

- `CrudEntity` = `'track' | 'tour_date' | 'merch' | 'link'`, with the **`CRUD`**
  registry (`fields`, `required`) — drives the generic dashboard forms
  (`createContent`/`updateContent`/`deleteContent`, `pickFields`,
  `content-sections.tsx`).
- `PublishableEntity` = `CrudEntity | 'media'`, with the **`PUBLISHABLE`**
  registry (`table`, `snapshot`, `orderBy`) — drives versioning/publish
  (`listContent`/`publicSnapshot`/`publishContent`, `publishAll`).
- The artist **profile** is published separately as a singleton
  (`publishProfile`, `ARTIST_SNAPSHOT`), not via a registry — it's one row, not a
  list, and is never tombstoned.

## Consequences

- The publish loop and the edit loop iterate **different sets** instead of "one
  set minus an exception"; `'media'` cannot reach the generic CRUD path (a
  compile error, not a runtime no-op).
- Adding a new content type = an entry in both registries; a publish-only entity
  (like media) = an entry in `PUBLISHABLE` + a `revisions.entity_type` CHECK
  value. The `table` lives once (in `PUBLISHABLE`) and is reused by the CRUD ops.
- Slight duplication remains: the artist field list appears in `ARTIST_SNAPSHOT`
  and the migration backfill (TS vs SQL — unavoidable). `get_public_site` reads
  the snapshot blob (`ap.data || {id,slug}`) rather than re-listing columns, so
  it is not a third copy.
