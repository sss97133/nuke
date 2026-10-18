// Actual canonical handler and SQL admission/current reader in the same disposable
// PG17 harness. Only the Supabase HTTP transport is adapted to local psql.
const assert = (ok: unknown, message = "assertion failed") => { if (!ok) throw Error(message); };
const args: string[] = JSON.parse(Deno.env.get("CAB_LINEAGE_PSQL_ARGS") ?? "[]");
const bin = Deno.env.get("CAB_LINEAGE_PSQL") ?? "";
assert(bin === "psql" || bin === "/opt/homebrew/opt/postgresql@17/bin/psql", "installed test psql only");
assert(args.includes("-d") && /^dm_refinement_sale_episode_integrity_[0-9]+_[0-9]+$/.test(args[args.indexOf("-d") + 1]), "task-owned database only");
const host = args[args.indexOf("-h") + 1];
assert(host === "localhost" || /^\/private\/tmp\/nuke-sale-episode-pg-[^/]+\/socket$/.test(host), "local test host only");
const literal = (value: unknown) => `'${String(value).replaceAll("'", "''")}'`;
async function sql(statement: string, service = false) {
  const run = await new Deno.Command(bin, { args: [...args, "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-c",
    `${service ? "SET ROLE service_role;" : ""}${statement}`], stdout: "piped", stderr: "piped" }).output();
  if (!run.success) throw Error(new TextDecoder().decode(run.stderr));
  return new TextDecoder().decode(run.stdout).trim();
}
assert(await sql("SELECT current_database()") === args[args.indexOf("-d") + 1]);
const selectors = JSON.parse(await sql(`SELECT jsonb_build_object('mode','cab_listing_capture_v1',
 'source_observation_id',md5('cab-original')::uuid,'snapshot_id',md5('cab-snapshot')::uuid,
 'source_vehicle_event_id',md5('cab-episode')::uuid,'dry_run',true)`));
Deno.env.set("SUPABASE_URL", "https://db.test");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");
let handler: (req: Request) => Promise<Response>;
const serve = Deno.serve;
// deno-lint-ignore no-explicit-any
(Deno as any).serve = (fn: typeof handler) => { handler = fn; };
await import("./index.ts");
Deno.serve = serve;
const originalFetch = globalThis.fetch;
let writes = 0, calls = 0, hideNextLookup = false;
globalThis.fetch = async (request, options) => {
  calls++;
  const url = new URL(typeof request === "string" ? request : request instanceof URL ? request.href : request.url);
  assert(url.origin === "https://db.test", "no source or inference fetch");
  const method = options?.method ?? (request instanceof Request ? request.method : "GET");
  const body = typeof options?.body === "string" ? JSON.parse(options.body) : null;
  const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status,
    headers: { "Content-Type": "application/json" } });
  try {
    if (url.pathname === "/rest/v1/rpc/qualify_cab_listing_capture") {
      return response(JSON.parse(await sql(`SELECT public.qualify_cab_listing_capture(
        ${literal(body.p_source)}::uuid,${literal(body.p_snapshot)}::uuid,${literal(body.p_episode)}::uuid,
        ${body.p_result ? literal(body.p_result) + "::uuid" : "NULL"})`, true)));
    }
    assert(url.pathname === "/rest/v1/vehicle_observations", "only canonical observation transport");
    if (method === "POST") {
      writes++;
      const id = await sql(`SELECT public.synthetic_insert_cab_receipt(${literal(JSON.stringify(body))}::jsonb)`, true);
      return response({ id }, 201);
    }
    if (hideNextLookup) { hideNextLookup = false; return response([]); }
    const keys = ["source_id", "source_identifier", "kind", "content_hash"];
    const where = keys.map(key => {
      const filter = url.searchParams.get(key);
      assert(filter?.startsWith("eq."), "exact replay filters required");
      return `${key}=${literal(filter!.slice(3))}`;
    }).join(" AND ");
    return response(JSON.parse(await sql(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',id)),'[]') FROM public.vehicle_observations WHERE ${where}`, true)));
  } catch (error) {
    const code = String(error).match(/ERROR:\s+([0-9A-Z]{5}):/)?.[1];
    if (!code) throw error;
    return response({ code, message: "synthetic database constraint refusal" }, code === "23505" ? 409 : 400);
  }
};
async function intake(body = selectors, token = "test-key") {
  const response = await handler!(new Request("https://handler.test", { method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  return { status: response.status, data: await response.json() };
}

Deno.test("actual handler preview, PostgreSQL admission and current reader preserve original testimony", async () => {
  const before = await sql("SELECT to_jsonb(o) FROM public.vehicle_observations o WHERE id=md5('cab-original')::uuid");
  const preview = await intake();
  assert(preview.status === 200 && preview.data.database_admission === "not_attempted" && writes === 0);
  const admitted = await intake({ ...selectors, dry_run: false });
  assert(admitted.status === 200 && admitted.data.success && !admitted.data.duplicate, JSON.stringify(admitted));
  assert(admitted.data.scope === "attributed_listing_narrative_only" && writes === 1);
  const receipt = await sql(`SELECT public.synthetic_cab_qualification(${literal(admitted.data.observation_id)}::uuid)`);
  assert(JSON.parse(receipt).result_verified === true);
  const replay = await intake({ ...selectors, dry_run: false });
  assert(replay.status === 200 && replay.data.duplicate && replay.data.observation_id === admitted.data.observation_id && writes === 1);
  hideNextLookup = true;
  const race = await intake({ ...selectors, dry_run: false });
  assert(race.status === 200 && race.data.duplicate && race.data.observation_id === admitted.data.observation_id, JSON.stringify(race));
  assert(await sql("SELECT to_jsonb(o) FROM public.vehicle_observations o WHERE id=md5('cab-original')::uuid") === before);
});
Deno.test("selector authentication and caller-value injection fail before transport", async () => {
  const before = calls;
  assert((await intake(selectors, "invalid-token")).status === 401);
  assert((await intake({ ...selectors, structured_data: { specification_truth: "verified" } })).status === 400);
  assert((await intake({ ...selectors, dry_run: undefined })).status === 400);
  assert((await intake({ extraction_method: "protected_cab_listing_capture_v1" })).status === 400);
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  Deno.env.set("SUPABASE_JWKS", JSON.stringify({ keys: [{ ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: "fixture", alg: "ES256" }] }));
  const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const unsigned = `${encode({ alg: "ES256", typ: "JWT", kid: "fixture" })}.${encode({ role: "authenticated",
    sub: selectors.source_observation_id, exp: Math.floor(Date.now() / 1000) + 60 })}`;
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, new TextEncoder().encode(unsigned)));
  const token = `${unsigned}.${btoa(String.fromCharCode(...signature)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
  assert((await intake(selectors, token)).status === 403, "signed-in users cannot invoke service-only custody");
  assert(calls === before);
});
Deno.test("withdrawal, private parent and source-body mutation invalidate actual handler and current receipt", async () => {
  const id = await sql("SELECT id FROM public.vehicle_observations WHERE extraction_method='protected_cab_listing_capture_v1'");
  for (const [change, restore] of [
    ["UPDATE public.vehicle_observations SET is_superseded=true WHERE id=md5('cab-original')::uuid",
      "UPDATE public.vehicle_observations SET is_superseded=false WHERE id=md5('cab-original')::uuid"],
    ["UPDATE public.vehicles SET is_public=false WHERE id=md5('vehicle-1')::uuid",
      "UPDATE public.vehicles SET is_public=true WHERE id=md5('vehicle-1')::uuid"],
    ["UPDATE public.listing_page_snapshots SET html=html||'changed' WHERE id=md5('cab-snapshot')::uuid",
      "UPDATE public.listing_page_snapshots SET html=left(html,length(html)-7) WHERE id=md5('cab-snapshot')::uuid"],
  ]) {
    await sql(change);
    try {
      assert((await intake({ ...selectors, dry_run: false })).status === 409);
      assert(JSON.parse(await sql(`SELECT public.synthetic_cab_qualification(${literal(id)}::uuid)`)).ok === false);
    } finally { await sql(restore); }
  }
  assert(JSON.parse(await sql(`SELECT public.synthetic_cab_qualification(${literal(id)}::uuid)`)).result_verified === true);
  await sql("DELETE FROM public.vehicle_observations WHERE extraction_method='protected_cab_listing_capture_v1'");
  globalThis.fetch = originalFetch;
});
