# Architecture Decision Records

Short records of the load-bearing decisions behind Lone Star (artist site
manager). Each ADR states the context, the decision, and its consequences.
Supersede rather than edit: add a new ADR that marks the old one superseded.

| # | Decision | Status |
|---|---|---|
| [0001](0001-multitenant-rls.md) | Tenant isolation in Postgres RLS; one public read door | Accepted |
| [0002](0002-draft-publish-revisions.md) | Draft → publish via a `revisions` snapshot layer | Accepted |
| [0003](0003-crud-vs-publishable-registries.md) | Separate CRUD and Publishable entity registries | Accepted |
| [0004](0004-data-driven-templates.md) | Data-driven, per-artist selectable site templates | Accepted |
| [0005](0005-integration-client-pattern.md) | Factory integration clients + source-conflict sync policy | Accepted |

See also: `PLAN.md` (original brief), `DASHBOARD_PLAN.md` (multi-page dashboard
plan + pressure-test), `PHASE0.md` (versioning foundation).
