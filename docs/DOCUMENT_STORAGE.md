# Document and contract file storage

## The bug this replaced

Uploading a document worked. Opening it never did — for any document, any
user, since the Document Vault shipped.

Two independent faults:

1. **The download route required a bearer token that a link cannot send.**
   `GET /uploads/documents/:filename` was wrapped in `authenticate`, which
   accepts `Authorization: Bearer` or a `token` cookie. The UI opened documents
   with `<a href={file_path} target="_blank">`. A browser navigation sends
   neither — and login has never issued a cookie (`res.cookie` appears nowhere
   in the server). Every click returned `401 {"error":"Authentication required"}`.

2. **Files were written to an ephemeral disk.** `backend/uploads/` lives inside
   the container. No volume is declared in `railway.json` or the `Dockerfile`,
   so every deploy destroyed every uploaded file while the database rows stayed
   behind, pointing at nothing.

`competitive_market_info` had already solved both — file bytes in Postgres, and
a `fetchAsBlobUrl` helper on the client — with a comment saying exactly why. The
Document Vault was built without either. This change brings it in line.

## How it works now

File bytes live in Postgres:

- `account_documents.file_data BYTEA` — nullable, because rows created by the
  old implementation have no bytes to migrate.
- `account_contract_files` — a new table; contracts previously wrote to disk and
  recorded a path on `accounts.contract_file_path`.

Both are created by `schema.sql`, which runs on boot. `account_documents` was
previously created by hand in production and had no definition in the repo at
all, so fresh environments could not bootstrap the feature.

### API

```
GET /api/documents/:docId/file[?download=1]        document bytes
GET /api/accounts/:id/contract-file[?download=1]   most recent contract
```

Both require authentication, return `410 file_unavailable` when the row predates
this change, and set `Content-Disposition: inline` unless `download=1`.

The old `/uploads/documents/:filename` and `/uploads/contracts/:filename` paths
now return `410` with an explanation rather than `401`, so a stale bookmark or a
cached bundle says something useful.

### Client

`frontend/src/services/files.ts` exposes `openAuthedFile(path, { download,
filename })`. It fetches with the bearer token, converts the response to a blob
URL, and opens or downloads it. Any file behind an authenticated route must go
through this — never a plain `<a href>`.

The document list returns `available` (`file_data IS NOT NULL`) instead of
`file_path`. Documents with `available: false` render greyed out with a "File
missing — please re-upload" badge.

## Consequence of the migration

**Files uploaded before this change are gone.** They were destroyed by earlier
deploys, not by this migration; their rows are kept so titles, types, uploaders
and dates survive, and the UI asks for a re-upload. There is nothing to recover.

## Note on size

Bytes in Postgres is the right trade at CHC's volume — it survives deploys with
no extra infrastructure and is backed up with everything else. Uploads are
capped at 15 MB (documents) and 10 MB (contracts). If the vault grows into the
thousands of files, move to Supabase Storage with signed URLs; the client helper
and the API shape would not have to change.
