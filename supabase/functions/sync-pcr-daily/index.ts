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

async function logSync(status: string, records: number, err: string | null) {
  await local.from("pcr_sync_log").insert({
    sync_type: "daily_sales",
    status,
    records_synced: records,
    error_message: err
  });
}

Deno.serve(async (req: Request) => {
  try {
    const expectedKey = await getSecret("pcr_sync_key");
    const providedKey = req.headers.get("x-sync-key");
    if (providedKey !== expectedKey) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { "Content-Type": "application/json" }
      });
    }

    const intranetKey = await getSecret("chc_intranet_anon_key");
    const intranet = createClient(INTRANET_URL, intranetKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    const { data: rows, error: fetchErr } = await intranet
      .from("pcr_data")
      .select("payload, uploaded_at, uploaded_by")
      .order("uploaded_at", { ascending: false })
      .limit(1);
    if (fetchErr) throw new Error(`intranet fetch: ${fetchErr.message}`);
    if (!rows || rows.length === 0) throw new Error("no pcr_data rows on intranet");
    const row = rows[0];
    const rowCount = Array.isArray(row.payload?.rows) ? row.payload.rows.length : 0;

    const { error: upsertErr } = await local.from("pcr_sync_data").upsert({
      id: 1,
      payload: row.payload,
      uploaded_by: row.uploaded_by,
      intranet_uploaded_at: row.uploaded_at,
      synced_at: new Date().toISOString()
    }, { onConflict: "id" });
    if (upsertErr) throw new Error(`local upsert: ${upsertErr.message}`);

    const { data: refreshResult, error: rpcErr } = await local.rpc("refresh_sales_data_from_pcr");
    if (rpcErr) throw new Error(`refresh rpc: ${rpcErr.message}`);
    const inserted = (refreshResult as any)?.inserted ?? 0;

    await logSync("success", inserted, null);
    return new Response(JSON.stringify({
      ok: true,
      payload_rows: rowCount,
      sales_rows_inserted: inserted,
      intranet_uploaded_at: row.uploaded_at
    }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    try { await logSync("error", 0, msg); } catch { /* ignore */ }
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
});
