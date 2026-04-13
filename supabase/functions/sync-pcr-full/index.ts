import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const INTRANET_URL = "https://mqpagzjbfwknzeubecif.supabase.co";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const local = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false }
});

async function getSecret(name: string): Promise<string> {
  const { data, error } = await local.rpc("get_vault_secret", { secret_name: name });
  if (error || !data) throw new Error(`vault miss: ${name}: ${error?.message ?? "null"}`);
  return data as string;
}

async function logSync(sync_type: string, status: string, records: number, err: string | null) {
  await local.from("pcr_sync_log").insert({ sync_type, status, records_synced: records, error_message: err });
}

async function syncSales(intranet: any) {
  const { data: rows, error } = await intranet
    .from("pcr_data").select("payload, uploaded_at, uploaded_by")
    .order("uploaded_at", { ascending: false }).limit(1);
  if (error) throw new Error(`pcr_data fetch: ${error.message}`);
  if (!rows || rows.length === 0) throw new Error("no pcr_data rows on intranet");
  const row = rows[0];
  const rowCount = Array.isArray(row.payload?.rows) ? row.payload.rows.length : 0;

  const { error: upsertErr } = await local.from("pcr_sync_data").upsert({
    id: 1, payload: row.payload, uploaded_by: row.uploaded_by,
    intranet_uploaded_at: row.uploaded_at, synced_at: new Date().toISOString()
  }, { onConflict: "id" });
  if (upsertErr) throw new Error(`pcr_sync_data upsert: ${upsertErr.message}`);

  const { data: refresh, error: rpcErr } = await local.rpc("refresh_sales_data_from_pcr");
  if (rpcErr) throw new Error(`refresh rpc: ${rpcErr.message}`);
  return { payload_rows: rowCount, inserted: Number((refresh as any)?.inserted ?? 0), intranet_uploaded_at: row.uploaded_at };
}

async function syncShops(intranet: any) {
  const now = new Date().toISOString();

  const { data: shops, error: listErr } = await intranet.from("shop_list").select("name, branch").order("name");
  if (listErr) throw new Error(`shop_list fetch: ${listErr.message}`);
  const shopRows = (shops ?? []).map((r: any) => ({ shop_name: r.name, branch: r.branch, synced_at: now }));
  const { error: delListErr } = await local.from("pcr_shop_list").delete().neq("id", -1);
  if (delListErr) throw new Error(`shop_list delete: ${delListErr.message}`);
  if (shopRows.length > 0) {
    const { error: insListErr } = await local.from("pcr_shop_list").insert(shopRows);
    if (insListErr) throw new Error(`shop_list insert: ${insListErr.message}`);
  }

  const { data: tRows, error: tFetchErr } = await intranet.from("shop_targets").select("data").order("id", { ascending: false }).limit(1);
  if (tFetchErr) throw new Error(`shop_targets fetch: ${tFetchErr.message}`);
  const targetsObj = tRows && tRows[0] ? tRows[0].data ?? {} : {};
  const targetRows = Object.entries(targetsObj).map(([shop_name, v]: [string, any]) => ({
    shop_name, target: Number(v?.target ?? 0), install: v?.install ?? "", salesperson: v?.salesperson ?? "", synced_at: now
  }));
  const { error: delTargetsErr } = await local.from("pcr_shop_targets").delete().neq("id", -1);
  if (delTargetsErr) throw new Error(`shop_targets delete: ${delTargetsErr.message}`);
  if (targetRows.length > 0) {
    const { error: insTargetsErr } = await local.from("pcr_shop_targets").insert(targetRows);
    if (insTargetsErr) throw new Error(`shop_targets insert: ${insTargetsErr.message}`);
  }
  return { shop_list_rows: shopRows.length, shop_targets_rows: targetRows.length };
}

Deno.serve(async (req: Request) => {
  try {
    const expectedKey = await getSecret("pcr_sync_key");
    const providedKey = req.headers.get("x-sync-key");
    if (providedKey !== expectedKey) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
    }

    const intranetKey = await getSecret("chc_intranet_anon_key");
    const intranet = createClient(INTRANET_URL, intranetKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    const sales = await syncSales(intranet);
    const shops = await syncShops(intranet);
    await logSync("pcr_full", "success", sales.inserted, null);

    return new Response(JSON.stringify({ ok: true, sales, shops }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    try { await logSync("pcr_full", "error", 0, msg); } catch {}
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
});
