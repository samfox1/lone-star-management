# Docs

## `docs/` (this folder)
Standing technical references and cross-repo contracts that don't belong at the
repo root: `contact-attachments-contract.md`, `custom-fonts-contract.md`,
`contact-endpoint.md`, `event-endpoint.md` — each documents a live endpoint or
payload shape for the site side (skeen etc.) to build against.

## `docs/adr/`
Architecture Decision Records — short, numbered records of load-bearing
decisions (tenant isolation, publish model, editor architecture, analytics
schema…). See `docs/adr/README.md` for the index. Superseded rather than
edited: a later ADR marks an earlier one superseded, both stay.

## `docs/archive/`
Finished plans and closed reviews — work that shipped, or a review whose
findings are all fixed. Kept as the record of why things are the way they are,
not as instructions for what to build next. Files are cited by NAME in code/test
comments, never by path, so moving them here doesn't break a citation. See
`docs/archive/README.md`.

## Active root docs
The repo root keeps only docs that are still the plan of record for open work,
or standing references consulted regularly:

- **AGENTS.md** — coding-agent rules: stack conventions, folder map, test
  discipline, the tools that enforce it.
- **CLAUDE.md** — points Claude Code at `AGENTS.md` (same rules, one source).
- **README.md** — the original build brief (spec); read `PLAN.md` alongside it.
- **PLAN.md** — implementation plan resolving the brief's open decisions.
- **CONTEXT.md** — shared domain vocabulary for the publish model; see
  `docs/adr/` for the decisions behind it.
- **CODE_AUDIT.md** — the standing code-audit pass: rules, silo map, ledger.
- **TODO.md** — the running to-do list.
- **steaksauce.md** — live Supabase schema audit, maintained by `/steaksauce`.
- **MERCH_PLAN.md** — Shopify-as-source merch plan; parked on Skeen's
  credentials, still the plan of record.
- **PRESENCE_PLAN.md** — what "on the site" means per content kind (draft vs.
  auto-publish), cited from migrations and code as the spec.
- **SEO_GEO_PLAN.md** — SEO/GEO plan; phases 1-3 live, phase 4 (ftbk/wren)
  waiting on Sam.
- **SITE_BRIDGE_PLAN.md** — the site-bridge standard (protocol, manifest,
  component kit); cited throughout `packages/site-bridge`.
- **SITE_EDITOR_PLAN.md** — visual site editor phased plan; the `libraries[]` +
  onboarding-questionnaire gap is still open (see its "Next" section).
- **SITE_STYLING_PLAN.md** — per-region style overrides + the custom-site
  contract; companion to ADR-0008.
- **BRAND_PAGE_PLAN.md** — brand page rebuild, plan of record.
- **BRAND_SYNC_PLAN.md** — brand ⇄ sites ⇄ editor sync, plan of record (most
  recent; active work).
- **RENAME_CHECKLIST.md** — mechanical checklist for the pending rename to
  Tapir.

Anything not on this list and not in `docs/archive/` should be treated as
missing, not assumed gone — check `git log --follow` before recreating it.
