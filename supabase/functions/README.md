# CHC CRM — PCR Sync Edge Functions (restored 2026-04-13)

Three Supabase Edge Functions that sync PCR data from the CHC Intranet project
(`mqpagzjbfwknzeubecif`) into the CRM project (`kupznjefaayewndyuccr`). The
original bundles were permanently unrecoverable (platform-side bundle loss on
2026-04-06). These are fresh replacements — **commit them to the CRM repo
under `supabase/functions/` so this never happens again.**

## Functions

| Function | Purpose | Cron |
|---|---|---|
| `sync-pcr-daily` | Pull latest `pcr_data` payload from intranet, upsert to `pcr_sync_data`, explode into `sales_data` via `refresh_sales_data_from_pcr()` | `*/30 11-23 * * 1-5` |
| `sync-pcr-shops` | Full refresh of `pcr_shop_list` and `pcr_shop_targets` from intranet `shop_list` / `shop_targets` | `30 9 * * *` |
| `sync-pcr-full` | Runs `sync-pcr-daily` + `sync-pcr-shops` back-to-back | `0 10 * * *` |

All three require header `x-sync-key: <pcr_sync_key>` (stored in Supabase Vault).

## Dependencies

- **DB function** `public.refresh_sales_data_from_pcr()` does the heavy payload
  explosion (104k rows → `sales_data`). The edge functions only move the
  payload from intranet → `pcr_sync_data` and call this RPC.
- **DB helper** `public.get_vault_secret(text)` — SECURITY DEFINER RPC,
  granted to `service_role` only. Returns decrypted secret by name.
- **Vault secrets** (CHC CRM project):
  - `chc_intranet_anon_key` — anon JWT for intranet REST calls
  - `pcr_sync_key` — shared header secret callers must present
  - `easeai_anon_key` — (legacy, not used by these functions)

## Deploying

```
supabase functions deploy sync-pcr-daily --no-verify-jwt --project-ref kupznjefaayewndyuccr
supabase functions deploy sync-pcr-shops --no-verify-jwt --project-ref kupznjefaayewndyuccr
supabase functions deploy sync-pcr-full  --no-verify-jwt --project-ref kupznjefaayewndyuccr
```

JWT verification is intentionally disabled — auth is enforced by the
`x-sync-key` header check inside each function (custom-auth pattern, allowed
by Supabase guidelines).

## Manual invoke

```
curl -X POST https://kupznjefaayewndyuccr.supabase.co/functions/v1/sync-pcr-full \
  -H "x-sync-key: $PCR_SYNC_KEY"
```

## 2026-04-13 restoration log

- 14:16 UTC — `sync-pcr-daily` restored, 104,368 rows synced (first success
  since 2026-04-06 14:04 UTC).
- 14:17 UTC — `sync-pcr-shops` restored, 668 shops + 83 targets.
- 14:18 UTC — `sync-pcr-full` restored, combined run.
- Existing pg_cron jobs (jobids 1/2/3) will continue to call these URLs on
  schedule — no cron changes needed.
