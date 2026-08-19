# Account archiving ("Mark inactive")

## What it does

An **inactive** account is one the team has stopped pursuing. It is kept in
full — contacts, notes, activities and sales are all retained — but it is
removed from every list and report people work from day to day.

| Where | Inactive account appears? |
| --- | --- |
| Accounts list (Customers / Leads) | No — unless **Show inactive** is on |
| Search and AI search | No |
| Follow-ups, overdue follow-ups | No (its follow-up date is cleared) |
| Dormant badge and dormant counts | No |
| Daily digest, activity reminders | No |
| Weekly reports (rep and manager) | No |
| Customer alerts, reorder alerts | No |
| Duplicate scanner and pending flags | No |
| CSV export | No — unless `?include_inactive=true` |
| Dashboard KPIs and status counts | No |
| **Revenue and sales reporting** | **Yes — history is preserved in full** |

Reactivating puts it back everywhere, with its previous pipeline status restored.

## Who can do it

Any authenticated user, on any account they can see, from either the Accounts
list or the account detail page. Every action is attributed in `audit_log`
(`inactivate` / `reactivate`) and mirrored as a note on the account, so the
reason is visible to the next person who opens it.

A reason is required. `other` also requires a note.

## Data model

Archiving lives on its own columns rather than on `status`:

| Column | Meaning |
| --- | --- |
| `inactive_at` | Archive flag. `NULL` = live. Every operational query filters on this. |
| `inactive_by_id` | Who archived it |
| `inactive_reason` | One of the codes in `INACTIVE_REASONS` (server) / `INACTIVE_REASON_LABELS` (client) |
| `inactive_note` | Free-text detail |
| `status_before_inactive` | Pipeline status to restore on reactivation |
| `reactivated_at`, `reactivated_by_id` | Last restore |

**Why not `status = 'inactive'`?** Two reasons, both learned the hard way:

1. `accounts_status_check` never permitted `'inactive'`, and `schema.sql`
   re-asserts that constraint on every boot. The previous one-click toggle
   therefore threw a constraint violation on every use and the UI swallowed
   the error — which is why the button appeared to do nothing.
2. The nightly PCR/AccountEdge sync owns `status` and flips non-`dnc`,
   non-`churned` customers back to `'active'`. Any archive stored in `status`
   would have been silently undone overnight. The sync now checks
   `inactive_at` and skips archived shops entirely, refreshing only their
   sync stamp.

## API

```
GET  /api/accounts?include_inactive=true    include archived in the list
GET  /api/accounts?inactive_only=true       only archived ("Show inactive")
GET  /api/accounts/inactive-reasons         reason codes + labels
POST /api/accounts/:id/inactivate           { reason, note? }  → 400 without a valid reason
POST /api/accounts/:id/reactivate           {}                 → 409 if already active
PATCH /api/accounts/:id/toggle-active       deprecated shim for older PWA bundles
```

The `toggle-active` shim exists only because installed PWAs may still be
running the previous bundle. It records the generic `not_pursuing` reason.
Remove it once the fleet has updated.

## Migration

Shipped in `backend/src/db/schema.sql`, which runs on every boot, so deploying
applies it. It is idempotent and safe to re-run.

The column additions and the backfill sit **above** the `accounts_status_check`
re-assertion on purpose: the backfill clears any legacy `status = 'inactive'`
row, and if it ran afterwards that row would fail the constraint and abort
startup.
