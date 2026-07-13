# Visual Site Editor — review findings (2026-07-13)

Multi-agent review of the editor feature (`dev` vs `main`): 6 dimension reviewers →
2 adversarial verifiers per finding (64 agents). 29 raised → **18 confirmed, 4
plausible, 7 dropped**. Deduped to distinct root causes below, worst first.

---

## 1. ✅ FIXED (2026-07-13) 🔴 HIGH — `deleteMediaAction` destroys the live storage object (data loss + broken live site)
**Fix:** `deleteMediaAction` now defers to `gcDeletedMediaObject` (removes the object only
if the media was never published; a published photo's object survives until its tombstone
publishes). Added `gcMediaObjects` (publish-time sweep of `{artistId}/gallery`), wired into
`publishAction` / `publishSiteAction` / `publishAllGatedAction`. Tests: `storage-gc-media.test.ts`.
`actions.ts:349-353` · findings #1, #4, #14 (CONFIRMED, 2× high-confidence)

Removing a gallery photo in the editor is a **draft** action, but `deleteMediaAction`
deletes the row **and** immediately `storage.remove([storagePath])`. The live public
site is served from **revision snapshots** (`get_public_site` reads the media
`storage_path` out of `published_revisions`, and the media branch is *not* existence-
filtered against the live table — unlike tracks/merch/videos). So the last published
revision still points at that path → **every visitor gets a 404 `<img>` on the live
site, and the file is unrecoverable**, before the manager publishes anything.

The function's own docstring (lines 335-342) describes the CORRECT behavior ("delete
only the registry row, NOT the Storage object… the published site still references it
until republish"); the code on line 353 and the inline comment on 351-352 contradict it.

- **Pre-existing** (shared with the Photos page delete), but the editor makes it feel
  like a safe draft edit. Highest impact.
- **Fix:** drop the eager `storage.remove` (match the docstring); defer object deletion
  to a publish-time GC of orphaned media (as videos already do via `gcVideoObjects`).
  Confirm a media GC exists or add one, else objects leak.

## 2. ✅ FIXED (2026-07-13) 🔴 HIGH — Optimistic revert clobbers concurrent in-flight ops
`editor-inspector.tsx:104-186` · findings #2, #10 (CONFIRMED)
**Fix:** a one-at-a-time concurrency guard (`if (isPending) return` on all nine
remove/reorder handlers, using `useTransition`'s `isPending`). No two ops can be in
flight, so each single-op `prev` revert is accurate — the clobber is impossible. Test:
"ignores a second remove while one is in flight" in `editor-inspector.test.tsx`. (A full
`useOptimistic` server-reconcile is a larger optional follow-up — see #4.)


Every remove/reorder handler captures `prev = <whole array>` and, on error,
`setState(prev)` — a full-list snapshot restore. Two ops in flight (remove buttons stay
enabled; `startTransition` discards `isPending`): op B succeeds, op A fails and reverts
to a snapshot that predates B → **resurrects a deleted row / discards a saved change**,
and the panel is permanently out of sync (state is seeded once from props, see #4).

- **Fix:** revert with a functional/targeted updater (re-insert only the failed item),
  or disable the control while its op is pending, and/or reconcile from server truth.

## 3. 🔴 HIGH — Reorder persistence is a non-atomic per-row loop
`gallery.ts:20-33` (and `reorderContentAction`) · finding #3 (CONFIRMED)

`reorderGallery`/`reorderContentAction` write `sort_order = i` row-by-row. A mid-loop
failure leaves the DB **half-renumbered** while the client reverts the whole UI to the
old order → persisted order corrupted, no rollback.

- **Fix:** batch the renumber in one statement/RPC (transactional), or at minimum
  re-fetch/repair on partial failure.

## 4. 🟡 MITIGATED (2026-07-13) 🟠 MEDIUM — Inspector state seeded once from props, never re-synced
`editor-inspector.tsx:96-100` + each `*Tools` value map · findings #9, #15 (CONFIRMED)
**Status:** the *dangerous* interaction (a failed op reverting to a snapshot that
predates a concurrent success) is gone with #2's guard, and after a successful op the
local state already equals the persisted truth, so no drift. Residual gap: an *external*
change (another tab/session) isn't reconciled while mounted. Complete fix = base the
lists on `useOptimistic(serverProp)` so every settled action re-reads server truth;
deferred as an optional follow-up (bigger refactor, browser-verify needed).


All lists + field values are `useState(initial)` seeded once. After any action's
`revalidatePath`, the fresh server data is **ignored while the editor stays mounted**,
so drift (from #2/#3, or another tab) never heals. Underlies several issues above.

- **Fix:** re-sync on prop change (effect or a `key`), or treat server data as the
  source of truth after each mutation.

## 5. ✅ FIXED (2026-07-13) 🟠 MEDIUM — Silent "Saved" on saves the server actually drops
`actions.ts:137` (extractUpdate) + `editor-inspector.tsx:931` · findings #11, #12 (CONFIRMED)
**Fix:** client-side validation gates the debounced save in the affected tools — Links
(label + url required), Music (title required), Merch (title required + price must be
blank or numeric). An invalid field no longer schedules a save (and is dropped from the
unmount flush), gets `aria-invalid` + a red ring, so the panel can't report "Saved" on a
write the server would drop. (Video already server-validated its title.) Tests: three
"does NOT save … flags it invalid" cases in `editor-inspector.test.tsx`.


- Clearing a **required** field (e.g. a link/song title) → `updateContent` no-ops the
  empty value, but the panel still shows "Saved" and keeps the blank value.
- A **non-numeric merch price** → coerced to `NaN` and dropped, yet "Saved" shows.

Both diverge the panel from the DB with a success indicator. **Fix:** validate in the
tool (block empty required / bad price) and surface the real result.

## 6. 🟠 MEDIUM — Debounced saves aren't sequenced (lost update)
`editor-inspector.tsx:552` · finding #16 (PLAUSIBLE)

No cancellation/ordering of in-flight saves; an older keystroke's save can land after a
newer one and overwrite it. **Fix:** ignore stale responses (per-field sequence token)
or cancel superseded requests.

## 7. ✅ FIXED (2026-07-13) 🟡 LOW — The chrome "Saved" chip is a hardcoded lie
**Fix:** removed the hardcoded chip from the floating controls; the real per-field status lives in each tool.
`editor-shell.tsx:85-87` · findings #17, #18 (CONFIRMED)

The prominent green-dot "Saved" in the floating controls is hardcoded and never reflects
real state (in-flight/failed). **Fix:** wire it to real save status, or remove it and
rely on the per-tool status.

## 8. 🟡 LOW — Panel-wide `status` flag clobbered by concurrent field saves
`editor-inspector.tsx:637` · finding #21 (CONFIRMED)

One `status` per tool; concurrent field saves overwrite each other's status (a failure
can be masked by a later success). **Fix:** per-field status, or drop the shared flag.

## 9. 🟡 LOW — Dead code / non-functional controls
`editor-inspector.tsx:278, 431` · findings #19, #20, #22 (CONFIRMED/PLAUSIBLE)

- `Component.caption` is dead — the 6-way count ternary (duplicated in BrowseView +
  EditingView) covers all kinds, so the `: caption` else-branch is unreachable.
- PhotoTools `perImage/display/columns/size` state drives the Sizing/Layout sections but
  is **non-functional** (nothing persisted) — the known deferred "sizing" work; consider
  hiding it until wired so it doesn't imply it works.
- The five `*Tools` duplicate the debounce/timer/pending/flush machinery, with a needless
  divergence (Set+`valuesRef` vs `Map<key,value>`). Extract one shared hook.

---

## Test gaps (all CONFIRMED, worth closing alongside the fixes)
findings #5, #6, #7, #13

- `publishAllGatedAction` — the password gate on live PROD publishes — only tested fully
  mocked; no test that a wrong password is actually rejected end-to-end.
- **flush-on-unmount** save path: untested.
- **revert-on-error** for all nine remove/reorder handlers: untested (every test mocks
  success, so a broken revert looks green).
- **switch component type / Back with a pending save**: the mid-debounce unmount flush is
  never exercised.
