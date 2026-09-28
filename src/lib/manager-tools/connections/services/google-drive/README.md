# Google Drive

Connecting Google Drive lets a manager browse an artist's link-shared Drive folder from
inside the dashboard and copy-import chosen audio, image and video files straight into
Lone Star's own storage and tables — no separate download-then-upload round trip.

## Connection type

Service (no public link). Drive has no artist profile page, so `src/lib/connections.ts`
never gives it a `social` — it is a standalone service (`kind: 'service'`, `section:
'files'`), the same way Bandsintown and Ticketmaster are. It never becomes a site button;
Drive is dashboard-only, always.

## What the manager enters

The registry's placeholder (`src/lib/integrations-registry.ts`) says **"Google Drive folder
link."** In the Connections modal this is a single plain text field (`ConnectField`'s
fallback branch, `connect-modal.tsx`), bound to `input.id`.

Errors seen, from `connectInputError` (`src/lib/connections.ts`):
- `Enter the Google Drive folder link.` — blank input.

Once connected, errors surface when the folder is actually reached (see Sync / integration):
- `That folder isn't shared publicly. In Drive, set it to "Anyone with the link" and try
  again.` (`FOLDER_NOT_SHARED`, `src/lib/drive.ts`)
- `That link points to a file, not a folder.` (`getFolder`, same file)
- `No Drive folder linked yet — connect one under Manager tools → Integrations.`
  (`driveFolderFor`, `actions.ts`) — stale wording; see Known gaps.

## How it is stored

- `artists.drive_folder_id text` — the connected folder, ideally the bare Drive id
  (migration `20260710120000_drive_integration.sql`).
- `drive_file_id` columns on `tracks`, `videos`, `media`, each with a partial unique index
  on `(artist_id, drive_file_id) where drive_file_id is not null` — lets the browser badge a
  file "Imported" and makes a re-import a clean no-op instead of a duplicate row.
- No Vault secret. Drive authenticates with one **global** API key, not a per-artist
  credential, so the folder id is the only per-artist state.
- No `links` row — Drive is a service, never a site button.
- `drive_file_id` never appears in any `content.ts` `PUBLISHABLE` snapshot, so it stays off
  the public site and every site payload by construction.

## Sync / integration

API: **Google Drive API v3**, `https://www.googleapis.com/drive/v3` (`src/lib/drive.ts`,
`createDriveClient`), with `supportsAllDrives=true` on every request. Auth: one global API
key, env var **`GOOGLE_API_KEY`** — no OAuth, no per-artist token. Missing key throws
`Google API key not configured (GOOGLE_API_KEY).`

Nothing auto-syncs the way Spotify or Bandsintown do. Drive is **browsed**, then a manager
explicitly **imports** one file at a time:
- Browsing lists a folder's media by kind — audio, image, video (`listMediaFiles`,
  `listAllMediaFiles`) — streaming names/sizes/thumbnails; nothing is written.
- Importing (`importDriveFileAction` → `importDriveFile`, `src/lib/drive-import.ts`)
  re-fetches the file's metadata server-side, validates it, downloads the bytes, and writes
  it exactly like a direct upload.
- "Check folder" (`checkDriveFolderAction`, the registry's `pull`) counts every media file
  across all three kinds and reports `Found N media file(s).` It writes nothing.

Where an import lands: audio → `tracks` (`source: 'manual'`, `audio_path`, `drive_file_id`
— an unreleased song), video → `videos` (`provider: 'uploaded'`, `on_site: false`,
`drive_file_id`), image → `media` (`purpose: 'gallery_image'`, `drive_file_id`).

How "connected" is proven: `connections/page.tsx`'s `sourceCounts` has no proof table for
the `files` section, so Drive's count is hard-coded to `1` once the folder id is set — it
can never read as "failed" the way a music source can. The code's own comment: "Drive is
browsed, not imported — connected is as proven as it gets."

Limits and quirks (from `drive.ts`'s comments): a **private** folder doesn't 403 on
`files.list` — it silently returns `[]` — so the only reliable share check is `files.get` on
the folder itself, whose 404 becomes `FOLDER_NOT_SHARED`. Drive v3's `size` is an int64
**string**. The API's own `thumbnailLink` expires within hours, so a stable keyless
`drive.google.com/thumbnail?id=…` URL is used instead (audio gets none). Downloading
(`alt=media`) returns raw bytes with a 429 backoff loop, and its byte cap is enforced
**while streaming**, not just from `Content-Length` (which can be absent). Pagination caps
at `maxPages` (default 20). Import size caps (`DRIVE_IMPORT`, `drive-import.ts`): audio 30
MB, image 25 MB, video 100 MB — video's cap is tighter than the bucket's own 500 MB because
the import buffers the whole file in a server action first. A file must be inside the
connected folder (`meta.parents.includes(folderId)`) or import is refused, so this can't
become "copy any public Drive file by id." A client-supplied file id is checked against a
strict `[A-Za-z0-9_-]+` charset before it is interpolated into a Drive URL. Re-importing the
same file trips the unique index → a friendly `Already imported from Drive.` (Postgres
`23505`).

How a pull is triggered: no schedule. A manager opens the Drive browser — a modal
(`DriveImportButton`) on the Music, Videos and Images pages, each bound to one kind — which
lists on open; imports run sequentially as files are picked. Separately, "Check folder" in
the Files sync dialog just counts.

## On the site

Nothing. Drive is a management-side copy tool only. Once imported, a file becomes an
ordinary track/video/media row and reaches the site through that type's normal publish
flow, indistinguishable from a direct upload; `drive_file_id` is excluded from every
publishable snapshot.

## Code map

- `src/lib/manager-tools/connections/services/google-drive/index.ts` — this service's own
  code: `source`: the `drive` registry entry (`idField: 'drive_folder_id'`, `section:
  'files'`).
- `src/lib/drive.ts` — `createDriveClient`: `parseDriveFolderId`, `driveKind`, `getFolder`,
  `listMediaFiles`, `listAllMediaFiles`, `getFileMeta`, `downloadFile`.
- `src/lib/drive-import.ts` — `importDriveFile`: validates kind/parent/extension/size,
  downloads, calls `performUpload`, maps `23505` to a friendly message.
- `src/lib/integrations-registry.ts` — assembles the entry above into
  `INTEGRATION_REGISTRY` (in `INTEGRATION_KEYS` order).
- `src/lib/connections.ts` — folds the registry entry into `CONNECTIONS` as a service.
- `src/app/artists/[id]/(dashboard)/integrations.ts` — wires `saveDriveFolderAction` /
  `checkDriveFolderAction` to the registry entry (see Known gaps for who calls `save`).
- `src/app/artists/[id]/(dashboard)/actions.ts` — `driveFolderFor`, `saveDriveFolderAction`,
  `checkDriveFolderAction`, `listDriveFilesAction`, `importDriveFileAction`.
- `src/app/artists/[id]/(dashboard)/drive-browser.tsx`, `drive-import-button.tsx` — the
  browser (list/select/import) and its modal shell (busy-latch against mid-import unmount).
- `src/app/artists/[id]/(dashboard)/images/page.tsx`, `music/page.tsx`, `videos/page.tsx` —
  wire the browser/button per kind, gated on `artist.drive_folder_id`.
- `src/app/artists/[id]/(dashboard)/(manager-tools)/connections/actions.ts` —
  `connectOneAction`, `disconnectConnectionAction`, `pullConnectionAction`: the path a
  manager actually uses today.
- `src/lib/service-icons.ts` — `SERVICE_ICONS.drive`.
- `supabase/migrations/20260710120000_drive_integration.sql` — the columns and indexes.
- `.env.example` — documents `GOOGLE_API_KEY`.

## Tests

- `tests/unit/sync/drive.test.ts` — the HTTP client: id parsing, kind detection, the
  private-folder quirk, int64 size string, pagination, 429 backoff, the streaming byte cap.
- `tests/unit/sync/drive-actions.test.ts` — the four server actions: the id-charset
  injection guard, ownership checks, friendly error wording.
- `tests/integration/sync/drive-import.test.ts` — `importDriveFile` against the real
  database: bytes land under `{artistId}/…`, `drive_file_id` registers, re-import dedupes
  and removes the orphaned object, cross-tenant storage RLS still blocks.
- `tests/components/sync/drive-browser.test.tsx` — names/sizes render, the Imported badge,
  sequential imports, a per-file failure stays inline, Load more, list-error rendering.

## Known gaps

- **The Connections tool never parses a pasted Drive folder link.** The field's placeholder
  asks for a "Google Drive folder link," and `parseDriveFolderId` (`src/lib/drive.ts`) exists
  to pull the id out of a `/folders/{id}` or `?id=` URL — but neither `connectOneAction`
  (`connections/actions.ts`, via `saveSourceIdAction`) nor the per-connection edit field in
  `connection-modal.tsx` (`saveId`, same function) ever calls it. Only
  `saveDriveFolderAction` (`dashboard/actions.ts`) parses, and it is wired only to
  `INTEGRATIONS.drive.save`, which nothing in the current UI calls — the one page that reads
  `intg.save` (`(dashboard)/connect/page.tsx`) only renders the three music sources. In
  practice, pasting a full share URL through Connections likely saves it raw, and the next
  Check or import sends that whole string to the Drive API and fails with the generic
  "not shared" message, which doesn't explain the real cause. A bare folder id is the safe
  thing to paste there today — found reading the code, not fixed.
- **A stale error message**: `driveFolderFor` (`actions.ts`) still points at "Manager tools
  → Integrations," which is now just a redirect to Connections.
- Whether `GOOGLE_API_KEY` is currently set is unknown from the code; project memory
  (2026-07-09) recorded it blocked on Sam creating the key — check `.env.local`, not here.
- No OAuth and no private folders: the model is deliberately public-link-only.
- No cleanup on deletion: a file removed from Drive, or a disconnected folder, leaves
  already-imported rows exactly as they are.
