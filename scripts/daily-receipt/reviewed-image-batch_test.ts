import { assert, assertEquals, assertRejects, assertThrows } from "jsr:@std/assert";
import { cliArgs, eligibleWorklist, exactRows, packReviews, parseStage, requireSubscription,
  subscriptionEnvironment, validateEnvelopeBatch, runBatch } from "./reviewed-image-batch.ts";
import { admitReviewedBatch } from "../deep-image-analysis-byok.mjs";

const vehicle = "20000000-0000-4000-8000-000000000001", image = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002", now = new Date().toISOString();
function work() { return [{ image_id: image, vehicle_id: vehicle, image_url: "https://example.invalid/source.jpg",
  expected_updated_at: now, day: "unknown", day_basis: "unknown", eligibility: { gallery_eligible: true,
    is_sensitive: false, is_duplicate: false, is_superseded: false, vision_gate_status: "approved" } }]; }
function verdict() { return { image_id: image, vehicle_id: vehicle, scene_type: "engine_bay", build_phase_guess: "unknown",
  intent: "unknown", intent_confidence: 0, needs_clarification: true, components_seen: [],
  state_observations: { rust_severity: "unknown", paint_state: "unknown", completeness: "unknown" },
  workshop_signals: { tools_visible: [], fixturing: "unknown", lighting: "unknown" }, presence: { person: false },
  camera_pose: { framing: "engine compartment", azimuth_deg: null, distance_est: null },
  narrative_one_line: "Engine compartment visible in the source image.", confidence: 0.9 }; }
function envelopes() {
  return packReviews([verdict()], work(), [{ image_id: image, image_url: work()[0].image_url,
    reviewed_url: work()[0].image_url, sha256: "a".repeat(64) }],
    { agent_model: "fixture-model", agent_tier: "subscription", extraction_method: "Read-only v1/teacher/v2", run_id: "fixture" }, now);
}
function stream(options: { failed?: boolean; toolError?: boolean; noRead?: boolean; tool?: string } = {}) {
  return [
    { type: "assistant", message: { model: "fixture-model", content: options.noRead ? [] : [{ type: "tool_use", name: options.tool ?? "Read", id: "t1", input: { file_path: "/private/fixture/source.jpg" } }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", is_error: options.toolError ?? false, content: [] }] } },
    { type: "result", subtype: options.failed ? "error_during_execution" : "success", is_error: options.failed ?? false,
      structured_output: { verdicts: [verdict()] }, usage: { input_tokens: 10 }, total_cost_usd: 0.1 },
  ].map(x => JSON.stringify(x)).join("\n");
}

Deno.test("current eligible source snapshot retained, including unknown source clock", () => {
  assertEquals(eligibleWorklist(work(), vehicle, 1), work());
  for (const field of ["is_sensitive", "is_duplicate", "is_superseded"]) {
    const w = work(); (w[0].eligibility as any)[field] = true;
    assertThrows(() => eligibleWorklist(w, vehicle, 1), Error, "worklist_source_ineligible");
  }
  const missing = work(); delete (missing[0] as any).expected_updated_at;
  assertThrows(() => eligibleWorklist(missing, vehicle, 1), Error, "snapshot_missing");
  assertThrows(() => eligibleWorklist([...work(), ...work()], vehicle, 2), Error, "identity_mismatch");
});
Deno.test("subscription-only auth and reader tools preserve permissions without API fallback", () => {
  assertEquals(subscriptionEnvironment({ HOME: "/home/fixture", PATH: "/bin", CLAUDE_CODE_OAUTH_TOKEN: "oauth",
    ANTHROPIC_API_KEY: "secret", SUPABASE_SERVICE_ROLE_KEY: "secret", ANTHROPIC_BASE_URL: "other",
    CLAUDE_CODE_USE_BEDROCK: "1" }), { HOME: "/home/fixture", PATH: "/bin", CLAUDE_CODE_OAUTH_TOKEN: "oauth" });
  requireSubscription({ loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty" });
  for (const auth of [{ loggedIn: false }, { loggedIn: true, authMethod: "api_key", apiProvider: "firstParty" }])
    assertThrows(() => requireSubscription(auth), Error, "subscription_auth_required");
  const args = cliArgs("chosen-model", "/private/fixture", {});
  assertEquals(args[args.indexOf("--tools") + 1], "Read");
  assertEquals(args[args.indexOf("--permission-mode") + 1], "manual");
  assert(args.includes('Read(//private/fixture/**)'));
  assert(args.includes('{"permissions":{"blockReadsOutsideWorkingDirectories":true}}'));
  assert(!args.some(x => /bypass|skip-permission|bare|fallback/.test(x)));
});
Deno.test("each full frame needs a successful Read receipt before a result counts", () => {
  const result = parseStage(stream(), ["/private/fixture/source.jpg"]);
  assertEquals(result.model, "fixture-model"); assertEquals(result.api_equivalent_cost_usd, 0.1);
  for (const options of [{ noRead: true }, { toolError: true }])
    assertThrows(() => parseStage(stream(options), ["/private/fixture/source.jpg"]), Error, "source_image_not_read");
  assertThrows(() => parseStage(stream({ failed: true }), ["/private/fixture/source.jpg"]), Error, "reader_stage_failed");
  assertThrows(() => parseStage(stream({ tool: "Bash" }), ["/private/fixture/source.jpg"]), Error, "unexpected_model_tool");
});
Deno.test("wrong or repeated IDs refuse; order never rewrites identity", () => {
  assertThrows(() => exactRows([{ image_id: other }], work()), Error, "identity_mismatch");
  assertThrows(() => exactRows([], work()), Error, "incomplete_verdicts");
  const a = verdict(); a.vehicle_id = other;
  assertThrows(() => packReviews([a], work(), [], {}, now), Error, "identity_mismatch");
});
Deno.test("existing strict envelope validator preserves source CAS and refuses invented enums", () => {
  const e = envelopes()[0]; assertEquals(e.source.expected_updated_at, now);
  assertEquals(e.source.reviewed_sha256, "a".repeat(64));
  assertEquals(validateEnvelopeBatch([e], vehicle), [e]);
  const bad = structuredClone(e); bad.verdict.scene_type = "invented";
  assertThrows(() => validateEnvelopeBatch([bad], vehicle));
  assertThrows(() => validateEnvelopeBatch([e, e], vehicle), Error, "identity_mismatch");
});
Deno.test("actual existing ingest adapter validates whole batch then calls only reviewed endpoint", async () => {
  const effects: string[] = [];
  const result = await admitReviewedBatch(envelopes(), vehicle, {
    validate: (e: any, v: string) => { effects.push("validate"); validateEnvelopeBatch(e, v); },
    invoke: (e: any) => { effects.push(e.action); return { data: { success: true, image_id: image, vehicle_id: vehicle,
      observation_id: "30000000-0000-4000-8000-000000000001", image_observation_id: "40000000-0000-4000-8000-000000000001", model_calls: 0 } }; },
  });
  assertEquals(effects, ["validate", "record_reviewed_analysis"]); assertEquals(result.wrote, 1); assertEquals(result.failed, 0);
});
Deno.test("validation or incomplete T2 receipt cannot report admission success", async () => {
  let called = false;
  await assertRejects(() => admitReviewedBatch(envelopes(), vehicle, { validate() { throw new Error("source invalid"); }, invoke() { called = true; } }), Error, "source invalid");
  assertEquals(called, false);
  const result = await admitReviewedBatch(envelopes(), vehicle, { validate: validateEnvelopeBatch,
    invoke: () => ({ data: { success: true, image_id: image, vehicle_id: vehicle, observation_id: "30000000-0000-4000-8000-000000000001", model_calls: 0 } }) });
  assertEquals(result.wrote, 0); assertEquals(result.failed, 1);
});
Deno.test("source CAS refusal retains partial receipts and stops remaining admission", async () => {
  const e = envelopes()[0];
  const batch = [e, structuredClone(e), structuredClone(e)];
  batch[1].verdict.image_id = other; batch[2].verdict.image_id = "10000000-0000-4000-8000-000000000003";
  let calls = 0;
  const result = await admitReviewedBatch(batch, vehicle, { validate: validateEnvelopeBatch,
    invoke: (p: any) => ++calls === 1 ? { data: { success: true, image_id: p.verdict.image_id, vehicle_id: vehicle,
      observation_id: "30000000-0000-4000-8000-000000000001", image_observation_id: "40000000-0000-4000-8000-000000000001", model_calls: 0 } } :
      { error: { context: Response.json({ error: "review_source_changed" }, { status: 409 }) } } });
  assertEquals(calls, 2); assertEquals([result.wrote, result.failed, result.remaining], [1, 1, 1]);
  assertEquals(result.receipts[1].error, "review_source_changed");
});

// Execute the real foreground harness with only process/network boundaries
// replaced. The fake reader opens each file and emits the real stream shape.
for (const bad of [false, true]) Deno.test(`foreground v1/teacher/v2 ${bad ? "refuses wrong final image ID" : "applies only after complete source reads"}`, async () => {
  const root = await Deno.makeTempDir({ prefix: "byok-reviewed-test-" });
  const oldPath = Deno.env.get("PATH")!, oldFetch = globalThis.fetch;
  const config = { work: work(), verdict: verdict(), bad, calls: `${root}/calls` };
  await Deno.writeTextFile(`${root}/config.json`, JSON.stringify(config));
  const fake = `#!/usr/bin/env node
const fs=require('node:fs');const c=JSON.parse(fs.readFileSync(${JSON.stringify(`${root}/config.json`)},'utf8'));
const a=process.argv.slice(2), opt=k=>a[a.indexOf(k)+1];
function log(x){fs.appendFileSync(c.calls,x+'\\n');}
if(process.argv[1].endsWith('dotenvx')){
 if(a.includes('prepare')){log('prepare');fs.writeFileSync(opt('--worklist'),JSON.stringify(c.work[0])+'\\n');}
 else if(a.includes('context')){log('context');fs.writeFileSync(opt('--out'),'Synthetic source context; time unknown.');}
 else if(a.includes('ingest')){log('ingest');const sink=opt('--sink');const packets=fs.readFileSync(sink,'utf8').trim().split('\\n').map(JSON.parse);
 fs.writeFileSync(sink+'.receipts.json',JSON.stringify({wrote:packets.length,failed:0,remaining:0,receipts:packets.map(p=>({image_id:p.verdict.image_id,success:true,observation_id:'30000000-0000-4000-8000-000000000001',image_observation_id:'40000000-0000-4000-8000-000000000001'}))}));console.log('ingest: wrote '+packets.length);}
 else process.exit(90);
}else if(a[0]==='auth'){log('auth');console.log(JSON.stringify({loggedIn:true,authMethod:'claude.ai',apiProvider:'firstParty'}));}
else{
 const prompt=fs.readFileSync(0,'utf8');const files=JSON.parse(prompt.split('FULL-FRAME FILES:\\n')[1].split('\\n')[0]);
 const previous=fs.readFileSync(c.calls,'utf8');const stage=previous.includes('teacher\\n')?'v2':previous.includes('v1\\n')?'teacher':'v1';log(stage);
 for(const f of files){fs.readFileSync(f.path);console.log(JSON.stringify({type:'assistant',message:{model:'fixture-model',content:[{type:'tool_use',id:f.image_id,name:'Read',input:{file_path:f.path}}]}}));
 console.log(JSON.stringify({type:'user',message:{content:[{type:'tool_result',tool_use_id:f.image_id,is_error:false,content:[]}]}}));}
 const value=stage==='teacher'?{reviews:[{image_id:c.work[0].image_id,findings:[]}]}:{verdicts:[{...c.verdict,...(c.bad&&stage==='v2'?{image_id:'10000000-0000-4000-8000-000000000099'}:{})}]};
 console.log(JSON.stringify({type:'result',subtype:'success',is_error:false,structured_output:value}));
}
`;
  for (const executable of ["claude", "dotenvx"]) {
    await Deno.writeTextFile(`${root}/${executable}`, fake, { mode: 0o700 });
  }
  Deno.env.set("PATH", `${root}:${oldPath}`);
  globalThis.fetch = (() => Promise.resolve(new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "Content-Type": "image/png" } }))) as typeof fetch;
  try {
    const args = ["--vehicle-id", vehicle, "--limit", "1", "--out-dir", `${root}/run`, "--apply"];
    if (bad) await assertRejects(() => runBatch(args), Error, "verdicts_identity_mismatch");
    else {
      await runBatch(args);
      const receipt = JSON.parse(await Deno.readTextFile(`${root}/run/run-receipt.json`));
      assertEquals(receipt.admitted, true); assertEquals(receipt.stages.length, 3);
      const e = JSON.parse((await Deno.readTextFile(`${root}/run/reviewed-envelopes.jsonl`)).trim());
      assertEquals(e.source.expected_updated_at, now); assertEquals(e.verdict.image_id, image);
    }
    const calls = (await Deno.readTextFile(config.calls)).trim().split("\n");
    assertEquals(calls, ["auth", "prepare", "context", "v1", "teacher", "v2", ...(bad ? [] : ["ingest"])]);
  } finally {
    globalThis.fetch = oldFetch; Deno.env.set("PATH", oldPath); await Deno.remove(root, { recursive: true });
  }
});
