# 0001 — Tenant isolation in Postgres RLS; one public read door

Status: Accepted

## Context

The product is multi-tenant: **tenant = artist**. The single most important
property is that a manager can never read or write an artist they don't manage.
App-layer checks alone are too easy to bypass or forget.

## Decision

- Enforce isolation in **Postgres Row-Level Security**, deny-by-default, on every
  table. App-layer checks are a second line only.
- Membership is decided in exactly one place: `is_manager_of(artist_id)` — a
  `SECURITY DEFINER` function doing one indexed lookup against `artist_managers`
  (no policy recursion). Admin is an un-forgeable signed JWT claim via
  `is_admin()` (`auth.jwt() -> app_metadata -> role`).
- The public site is unauthenticated, so it cannot use RLS. It reads through
  **exactly one anon-reachable door**: the `get_public_site(slug)`
  `SECURITY DEFINER` function, which returns published, public-safe fields only.
- Every other anon-reachable entry must be the same shape: `revoke all` + grant
  `anon`, a `SECURITY DEFINER` function that resolves the tenant from the slug and
  returns only public-safe data. (Shopify Vault functions follow this; gated
  audio's `sign_audio` will too.)
- Per-tenant secrets (Shopify tokens) live in **Supabase Vault**, referenced by a
  `secret_ref` pointer; the raw token is never in a readable column.
- Storage is scoped by path: `{artist_id}/…`, with `storage.objects` RLS checking
  `is_manager_of` on the first path segment.
- The service-role key bypasses RLS and is used in only two narrow places:
  migrations/seeding and server-side reads that re-enforce scope. Never in a
  manager-facing route.

## Consequences

- Isolation holds even if an app-layer check is forgotten; it is provable and
  heavily tested (every content endpoint tested from a different tenant's
  manager, plus raw-RLS read/write denial).
- `get_public_site` is the most security-sensitive function in the system. Any
  change to it must re-run the public-read isolation tests (the CI canary), and
  the artist snapshot is an explicit field allowlist — never `select *` / whole-
  row `to_jsonb` into the public payload (config/secret columns would leak).
- New features that touch the public site add anon doors; each must follow the
  resolve-from-slug + published-only pattern, or the invariant erodes.
