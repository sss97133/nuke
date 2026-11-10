import { assert, assertEquals, assertRejects, assertThrows } from "jsr:@std/assert";
import { cliArgs, eligibleWorklist, exactRows, packReviews, parseStage, requireSubscription,
  subscriptionEnvironment, stageSchema, captureCommand, validateEnvelopeBatch, runBatch, sourceClockContext } from "./reviewed-image-batch.ts";
import { admitReviewedBatch, persistReviewedBatchReceipt } from "../deep-image-analysis-byok.mjs";
import { recordReviewedAnalysis } from "../../supabase/functions/photo-pipeline-orchestrator/reviewedAnalysis.ts";

const vehicle = "20000000-0000-4000-8000-000000000001", image = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002", now = new Date().toISOString();
Deno.test("source clock context excludes unrelated private source properties", () => {
  const rows = sourceClockContext([{ image_id: image, vehicle_id: vehicle, day: "2025-01-01", day_basis: "recorded_taken_at",
    image_url: "private-storage-url", exif: { gps: "private GPS" }, file_name: "private owner", prior: "private notes" }]);
  assertEquals(rows, [{ image_id: image, vehicle_id: vehicle, attached_image_index: 1, day: "2025-01-01", day_basis: "recorded_taken_at" }]);
});
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

Deno.test("admission validator runs with read permission only and no environment access", async () => {
  const directory = await Deno.makeTempDir({ prefix: "reviewed-readonly-validator-" });
  try {
    const sink = `${directory}/reviewed.jsonl`;
    await Deno.writeTextFile(sink, envelopes().map(x => JSON.stringify(x)).join("\n"));
    const result = await new Deno.Command(Deno.execPath(), {
      args: ["run", "--cached-only", "--node-modules-dir=none", "--allow-read",
        new URL("./reviewed-image-batch.ts", import.meta.url).pathname,
        "--validate-sink", sink, "--vehicle-id", vehicle],
      stdout: "piped", stderr: "piped",
    }).output();
    assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
    assert(new TextDecoder().decode(result.stdout).includes("Reviewed envelope batch valid."));
  } finally { await Deno.remove(directory, { recursive: true }); }
});
function stream(options: { failed?: boolean; noComplete?: boolean; tool?: string; model?: string } = {}) {
  return [
    { type: "thread.started", thread_id: "fixture-thread", ...(options.model ? { model: options.model } : {}) },
    { type: "turn.started" },
    ...(options.tool ? [{ type: "item.completed", item: { type: options.tool } }] : []),
    { type: "item.completed", item: { type: "agent_message", text: JSON.stringify({ verdicts: [verdict()] }) } },
    ...(options.noComplete ? [] : [{ type: options.failed ? "turn.failed" : "turn.completed", usage: { input_tokens: 10 } }]),
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
Deno.test("ChatGPT subscription and attached images retain sandbox/rules without API fallback", () => {
  assertEquals(subscriptionEnvironment({ HOME: "/home/fixture", USER: "fixture", LOGNAME: "fixture", PATH: "/bin", CODEX_HOME: "/home/fixture/.codex",
    OPENAI_API_KEY: "secret", CODEX_API_KEY: "secret", CLAUDE_CODE_OAUTH_TOKEN: "oauth", SUPABASE_SERVICE_ROLE_KEY: "secret", OPENAI_BASE_URL: "other" }),
    { HOME: "/home/fixture", USER: "fixture", LOGNAME: "fixture", PATH: "/bin", CODEX_HOME: "/home/fixture/.codex" });
  requireSubscription("Logged in using ChatGPT\n");
  for (const auth of ["Not logged in", "Logged in using an API key", "{loggedIn:true}"])
    assertThrows(() => requireSubscription(auth), Error, "subscription_auth_required");
  const args = cliArgs("gpt-6-astra", "/private/fixture", "/private/schema.json", "/private/out.json", ["/private/fixture/image.jpg"], ["custom-server"]);
  assertEquals(args[args.indexOf("--sandbox") + 1], "read-only");
  assertEquals(args[args.indexOf("--image") + 1], "/private/fixture/image.jpg");
  assert(args.indexOf("-") < args.indexOf("--image"));
  assert(args.includes('forced_login_method="chatgpt"') && args.includes('model_provider="openai"'));
  assert(args.includes('mcp_servers.custom-server={enabled=false,command="/usr/bin/false"}') && args.includes('web_search="disabled"'));
  assert(!args.some(x => /bypass|ignore-rules|ignore-user-config|never|fallback/.test(x) && x !== "never")); // color never is not an approval flag
  assert(!args.includes('approval_policy="never"'));
  assertThrows(() => cliArgs("claude-opus", "/tmp", "schema", "out", ["image"]), Error, "openai_model_and_images_required");
});
Deno.test("early process refusal retains stderr even when large stdin hits a closed pipe", async () => {
  const result = await captureCommand("node", { args: ["-e", 'process.stderr.write("synthetic startup refusal\\n");process.exit(2)'] }, "x".repeat(2_000_000));
  assertEquals(result.success, false); assertEquals(result.code, 2);
  assert(new TextDecoder().decode(result.stderr).includes("synthetic startup refusal"));
  assert(result.stdin_error !== null);
});
Deno.test("Codex completed attachment invocation retains truthful unreported model provenance", () => {
  const result = parseStage(stream(), ["/private/fixture/source.jpg"], "gpt-6-astra");
  assertEquals(result.actual_model, null); assertEquals(result.requested_model, "gpt-6-astra");
  assertEquals(result.model, "codex-cli (requested gpt-6-astra; runtime model unreported)");
  assertEquals(result.image_delivery, "codex_cli_explicit_attachments");
  assertEquals(result.api_equivalent_cost_usd, null);
  assertEquals(parseStage(stream({ model: "runtime-model" }), ["image"], "gpt-6-astra").actual_model, "runtime-model");
  for (const options of [{ noComplete: true }, { failed: true }])
    assertThrows(() => parseStage(stream(options), ["image"], "gpt-6-astra"), Error, "reader_stage_failed");
  for (const tool of ["command_execution", "mcp_tool_call", "web_search", "file_change"])
    assertThrows(() => parseStage(stream({ tool }), ["image"], "gpt-6-astra"), Error, "unexpected_model_tool");
});
Deno.test("closed provider schema retains the existing verdict fields without fabricated values", () => {
  const schema = stageSchema("verdicts");
  function check(x: any) {
    if (x.type === "object") { assertEquals(x.additionalProperties, false); assertEquals(x.required, Object.keys(x.properties)); Object.values(x.properties).forEach(check); }
    if (x.type === "array") check(x.items);
  }
  check(schema); check(stageSchema("reviews"));
  assert(schema.properties.verdicts.items.properties.camera_pose.properties.azimuth_deg.type.includes("null"));
});
Deno.test("only the known pre-turn experimental configuration warning is retained as a warning", () => {
  const warning = JSON.stringify({ type: "item.completed", item: { type: "error", message: "Under-development features enabled: chronicle. Under-development features are incomplete and may behave unpredictably. To suppress this warning, set suppress_unstable_features_warning." } });
  assertEquals(parseStage(warning + "\n" + stream(), ["image"], "gpt-6-astra").warnings.length, 1);
  assertThrows(() => parseStage(stream() + "\n" + warning, ["image"], "gpt-6-astra"), Error, "unexpected_model_tool");
  assertThrows(() => parseStage(warning.replace("Under-development", "Unknown") + "\n" + stream(), ["image"], "gpt-6-astra"), Error, "unexpected_model_tool");
});
Deno.test("recovered routing discovery warning retains successful answer but not terminal or incomplete reads", () => {
  const warning = JSON.stringify({ type: "error", message: "Reconnecting... 2/5 (workspace routing discovery timed out)" });
  const add = (s: string) => s.split("\n").flatMap(line => JSON.parse(line).type === "turn.started" ? [line, warning] : [line]).join("\n");
  assertEquals(parseStage(add(stream()), ["image"], "gpt-6-astra").warnings, [JSON.parse(warning).message]);
  for (const bad of [add(stream({ noComplete: true })), add(stream({ failed: true })), warning + "\n" + stream(), stream() + "\n" + warning,
    add(stream()).replace("workspace routing discovery timed out", "authentication refused")])
    assertThrows(() => parseStage(bad, ["image"], "gpt-6-astra"), Error, "reader_stage_failed");
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
Deno.test("a sibling cover version change stops the next real review before its intake", async () => {
  const batch = [envelopes()[0], structuredClone(envelopes()[0])]; batch[1].verdict.image_id = other;
  let siblingVersion = now, admitted = 0, projected = 0;
  const result = await admitReviewedBatch(batch, vehicle, { validate: validateEnvelopeBatch,
    invoke: async (p: any) => {
      try {
        const data = await recordReviewedAnalysis(p, {
          authorize: async () => true,
          readImage: async (id: string) => ({ id, vehicle_id: vehicle, image_url: work()[0].image_url,
            updated_at: id === other ? siblingVersion : now, vision_gate_status: "approved", ai_scan_metadata: {} }),
          ingest: async () => { admitted++; return { success: true, observation_id: "30000000-0000-4000-8000-000000000001" }; },
          project: async (id: string) => {
            projected++;
            // The cover writer's sibling is_primary update advances updated_at.
            // No source bytes changed; the strict snapshot still must not be refreshed here.
            siblingVersion = new Date(Date.parse(now) + 1000).toISOString();
            return { success: true, observation_id: id, image_id: p.verdict.image_id, vehicle_id: vehicle,
              image_observation_id: "40000000-0000-4000-8000-000000000001" };
          },
        });
        return { data };
      } catch (e) {
        return { error: { context: Response.json({ error: (e as Error).message }, { status: 409 }) } };
      }
    } });
  assertEquals([admitted, projected, result.wrote, result.failed], [1, 1, 1, 1]);
  assertEquals(result.receipts[0].image_id, image);
  assertEquals(result.receipts[1].error, "review_source_changed");
});
Deno.test("confirmed receipt is durable while the next admission is still pending", async () => {
  const dir = await Deno.makeTempDir({ prefix: "review-progress-test-" }), path = `${dir}/receipts.json`;
  const batch = [envelopes()[0], structuredClone(envelopes()[0])]; batch[1].verdict.image_id = other;
  let release!: () => void, reached!: () => void;
  const pending = new Promise<void>(r => release = r), entered = new Promise<void>(r => reached = r);
  let calls = 0;
  const run = admitReviewedBatch(batch, vehicle, { validate: validateEnvelopeBatch,
    persist: (receipt: unknown) => persistReviewedBatchReceipt(path, receipt),
    invoke: async (p: any) => {
      if (++calls === 1) return { data: { success: true, image_id: p.verdict.image_id, vehicle_id: vehicle,
        observation_id: "30000000-0000-4000-8000-000000000001", image_observation_id: "40000000-0000-4000-8000-000000000001", model_calls: 0 } };
      reached(); await pending; throw new Error("response lost");
    } });
  try {
    await entered;
    // This is the file a killed/timed-out child leaves; no completed function
    // return or final ingest write is needed to preserve the first admission.
    const durable = JSON.parse(await Deno.readTextFile(path));
    assertEquals([durable.wrote, durable.failed, durable.unknown, durable.remaining], [1, 0, 1, 0]);
    assertEquals(durable.in_flight, other); assertEquals(durable.complete, false);
    assertEquals(durable.receipts[0].image_id, image); assertEquals(durable.receipts[0].success, true);
    assertEquals(durable.receipts[0].image_observation_id, "40000000-0000-4000-8000-000000000001");
  } finally { release(); await run; }
  const final = JSON.parse(await Deno.readTextFile(path));
  assertEquals([final.wrote, final.failed, final.unknown], [1, 1, 1]);
  assertEquals(final.receipts[1].outcome, "unverified");
  await Deno.remove(dir, { recursive: true });
});

// Execute the real foreground harness with only process/network boundaries
// replaced. The fake reader opens each file and emits the real stream shape.
for (const bad of [false, true]) Deno.test(`foreground v1/teacher/v2 ${bad ? "refuses wrong final image ID" : "applies only after complete source reads"}`, async () => {
  const root = await Deno.makeTempDir({ prefix: "byok-reviewed-test-" });
  const oldPath = Deno.env.get("PATH")!, oldFetch = globalThis.fetch;
  const config = { work: work(), verdict: verdict(), bad, calls: `${root}/calls` };
  Object.assign(config.work[0], { exif: { gps: { lat: 1, lon: 2 }, location_name: "PRIVATE LOCATION" }, owner_notes: "PRIVATE OWNER" });
  await Deno.writeTextFile(`${root}/config.json`, JSON.stringify(config));
  const fake = `#!/usr/bin/env node
const fs=require('node:fs');const c=JSON.parse(fs.readFileSync(${JSON.stringify(`${root}/config.json`)},'utf8'));
const a=process.argv.slice(2), opt=k=>a[a.indexOf(k)+1];
function log(x){fs.appendFileSync(c.calls,x+'\\n');}
if(process.argv[1].endsWith('dotenvx')){
 if(a.includes('prepare')){log('prepare');fs.writeFileSync(opt('--worklist'),JSON.stringify(c.work[0])+'\\n');}
 else if(a.includes('context')){log('context');fs.writeFileSync(opt('--out'),'Receipt part FOAM1, quantity 1, cost $123.45; shipped.');}
 else if(a.includes('ingest')){log('ingest');const sink=opt('--sink');const packets=fs.readFileSync(sink,'utf8').trim().split('\\n').map(JSON.parse);
 fs.writeFileSync(sink+'.receipts.json',JSON.stringify({wrote:packets.length,failed:0,remaining:0,receipts:packets.map(p=>({image_id:p.verdict.image_id,success:true,observation_id:'30000000-0000-4000-8000-000000000001',image_observation_id:'40000000-0000-4000-8000-000000000001'}))}));console.log('ingest: wrote '+packets.length);}
 else process.exit(90);
}else if(a[0]==='login'){log('auth');console.log('Logged in using ChatGPT');}
else if(a[0]==='mcp'){log('mcp');console.log(JSON.stringify([{name:'fixture-server'}]));}
else{
 const prompt=fs.readFileSync(0,'utf8');const files=JSON.parse(prompt.split('ATTACHED SOURCE ORDER AND RECORDED DAY BASIS:\\n')[1].split('\\n')[0]);
 const previous=fs.readFileSync(c.calls,'utf8');const stage=previous.includes('teacher\\n')?'v2':previous.includes('v1\\n')?'teacher':'v1';log(stage);
 const attached=a.flatMap((v,i)=>v==='--image'?[a[i+1]]:[]);if(attached.length!==files.length||files.some((f,i)=>!attached[i].endsWith('/'+f.image_id+'.png')))process.exit(91);
 if(prompt.includes('PRIVATE OWNER')||prompt.includes('PRIVATE LOCATION')||prompt.includes(c.work[0].image_url)||prompt.includes(attached[0]))process.exit(92);
 if(!prompt.includes('cost $123.45'))process.exit(94);
 for(const path of attached)fs.readFileSync(path);
 console.log(JSON.stringify({type:'thread.started',thread_id:'fixture-thread'}));console.log(JSON.stringify({type:'turn.started'}));
 const value=stage==='teacher'?{reviews:[{image_id:c.work[0].image_id,findings:[]}]}:{verdicts:[{...c.verdict,...(c.bad&&stage==='v2'?{image_id:'10000000-0000-4000-8000-000000000099'}:{})}]};
 fs.writeFileSync(opt('--output-last-message'),JSON.stringify(value));
 console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify(value)}}));
 console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:10,output_tokens:20}}));
}
`;
  for (const executable of ["codex", "dotenvx"]) {
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
    assertEquals(calls, ["auth", "mcp", "prepare", "context", "v1", "teacher", "v2", ...(bad ? [] : ["ingest"])]);
    if (!bad) {
      await Deno.writeTextFile(config.calls, "");
      globalThis.fetch = (() => { throw new Error("resume must not download"); }) as typeof fetch;
      await runBatch(["--vehicle-id", vehicle, "--limit", "1", "--out-dir", `${root}/prepare-only`, "--prepared-dir", `${root}/run`, "--prepare-only"]);
      assertEquals((await Deno.readTextFile(config.calls)).trim().split("\n"), ["auth", "mcp"]);
      assertEquals(JSON.parse(await Deno.readTextFile(`${root}/prepare-only/preparation-receipt.json`)).model_calls, 0);
      await Deno.writeTextFile(config.calls, "");
      await runBatch(["--vehicle-id", vehicle, "--limit", "1", "--out-dir", `${root}/retry`, "--prepared-dir", `${root}/run`]);
      assertEquals((await Deno.readTextFile(config.calls)).trim().split("\n"), ["auth", "mcp", "v1", "teacher", "v2"]);
      const retry = JSON.parse(await Deno.readTextFile(`${root}/retry/run-receipt.json`));
      assertEquals(retry.prepared_from, `${root}/run`); assertEquals(retry.admitted, false);
      const legacy = JSON.parse(await Deno.readTextFile(`${root}/retry/v1.process.json`));
      delete legacy.started_at; delete legacy.finished_at; delete legacy.finished_at_basis;
      await Deno.writeTextFile(`${root}/retry/v1.process.json`, JSON.stringify(legacy));
      await Deno.writeTextFile(config.calls, "");
      await runBatch(["--vehicle-id", vehicle, "--limit", "1", "--out-dir", `${root}/stage-retry`, "--prepared-dir", `${root}/run`, "--resume-stages-from", `${root}/retry`]);
      assertEquals((await Deno.readTextFile(config.calls)).trim().split("\n"), ["auth", "mcp"]);
      const staged = JSON.parse(await Deno.readTextFile(`${root}/stage-retry/run-receipt.json`));
      assert(staged.stages.every((s: any) => s.reused_from === `${root}/retry`));
      assertEquals(staged.stages[0].finished_at_basis, "resume_validation_time");
      await runBatch(["--vehicle-id", vehicle, "--limit", "1", "--out-dir", `${root}/stage-retry-again`, "--prepared-dir", `${root}/run`, "--resume-stages-from", `${root}/stage-retry`]);
      const again = JSON.parse(await Deno.readTextFile(`${root}/stage-retry-again/run-receipt.json`));
      assertEquals(again.stages[0].finished_at_basis, "resume_validation_time");
      await Deno.writeTextFile(`${root}/retry/v1.prompt.txt`, "changed context");
      await assertRejects(() => runBatch(["--vehicle-id", vehicle, "--limit", "1", "--out-dir", `${root}/bad-stage`, "--prepared-dir", `${root}/run`, "--resume-stages-from", `${root}/retry`]), Error, "stage_resume_context_mismatch");
      await Deno.writeTextFile(`${root}/run/${image}.png`, "changed");
      await assertRejects(() => runBatch(["--vehicle-id", vehicle, "--limit", "1", "--out-dir", `${root}/bad-retry`, "--prepared-dir", `${root}/run`]), Error, "reviewed_bytes_changed");
    }
  } finally {
    globalThis.fetch = oldFetch; Deno.env.set("PATH", oldPath); await Deno.remove(root, { recursive: true });
  }
});
