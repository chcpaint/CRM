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

export async function syncShops(intranet: any, localClient: any) {
  const { data: shops, error: listErr } = await intranet
    .from("shop_list").select("name, branch").order("name");
  if (listErr) throw new Error(`shop_list fetch: ${listErr.message}`);

  const now = new Date().toISOString();
  const shopRows = (shops ?? []).map((r: any) => ({ shop_name: r.name, branch: r.branch, synced_at: now }));

  const { error: delListErr } = await localClient.from("pcr_shop_list").delete().neq("id", -1);
  if (delListErr) throw new Error(`shop_list delete: ${delListErr.message}`);
  if (shopRows.length > 0) {
    const { error: insListErr } = await localClient.from("pcr_shop_list").insert(shopRows);
    if (insListErr) throw new Error(`shop_list insert: ${insListErr.message}`);
  }

  const { data: tRows, error: tFetchErr } = await intranet
    .from("shop_targets").select("data").order("id", { ascending: false }).limit(1);
  if (tFetchErr) throw new Error(`shop_targets fetch: ${tFetchErr.message}`);
  const targetsObj = tRows && tRows[0] ? tRows[0].data ?? {} : {};

  const targetRows = Object.entries(targetsObj).map(([shop_name, v]: [string, any]) => ({
    shop_name,
    target: Number(v?.target ?? 0),
    install: v?.install ?? "",
    salesperson: v?.salesperson ?? "",
    synced_at: now
  }));

  const { error: delTargetsErr } = await localClient.from("pcr_shop_targets").delete().neq("id", -1);
  if (delTargetsErr) throw new Error(`shop_targets delete: ${delTargetsErr.message}`);
  if (targetRows.length > 0) {
    const { error: insTargetsErr } = await localClient.from("pcr_shop_targets").insert(targetRows);
    if (insTargetsErr) throw new Error(`shop_targets insert: ${insTargetsErr.message}`);
  }

  return { shop_list_rows: shopRows.length, shop_targets_rows: targetRows.length };
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

    const result = await syncShops(intranet, local);
    await logSync("shops", "success", result.shop_list_rows + result.shop_targets_rows, null);

    return new Response(JSON.stringify({ ok: true, ...result }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    try { await logSync("shops", "error", 0, msg); } catch {}
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
});
