// Fixture tests for check-write-guard's caller classes:  node --test scripts/guardrails/check-write-guard.test.mjs
// Each case writes a tiny functions tree (by default the two service-class deal-jacket functions plus an empty _shared)
// and a caller-class manifest, and runs the check against them through CHECK_WRITE_GUARD_FN_DIR and
// CHECK_WRITE_GUARD_MANIFEST.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CHECK = path.join(path.dirname(fileURLToPath(import.meta.url)), "check-write-guard.mjs");

const CLIENT = `const supabase = createClient(url, projectSecretKey());\n`;
const head = `import { requireOwnerOrService, isServiceCaller, requireWriteAuth } from "../_shared/writeGuard.ts";
${CLIENT}Deno.serve(async (req) => {
  const denied = await requireWriteAuth(req);
  if (denied) return denied;
`;
const tail = `  if (req.method === "OPTIONS") return new Response(null);
  const body = await req.json();
  await supabase.from("vehicle_images").update({ vehicle_id: body.v }).eq("id", body.i);
  return new Response("ok");
});
`;
const GATED = head + `  const notOwner = await requireOwnerOrService(req);
  if (notOwner) return notOwner;
` + tail;

// The service-class refusal names the function.
const SCOPED = /deal-jacket-pipeline: class service, but no requireAdminOrService/;
const SERVICE_ROW = { class: "service", reason: "fixture" };
const DEFAULT_MANIFEST = { open_ceiling: 0, functions: { "deal-jacket-pipeline": SERVICE_ROW, "forensic-deal-jacket": SERVICE_ROW } };
function refusedScoped(r) {
  assert.equal(r.code, 1);
  assert.match(r.out, SCOPED);
}
function run(files, manifest = DEFAULT_MANIFEST) {
  const dir = mkdtempSync(path.join(tmpdir(), "cwg-"));
  try {
    mkdirSync(path.join(dir, "_shared"));
    writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest));
    for (const [fn, src] of Object.entries(files)) {
      mkdirSync(path.join(dir, fn));
      // a string is index.ts; an object maps file names to sources
      for (const [f, body] of Object.entries(typeof src === "string" ? { "index.ts": src } : src)) {
        writeFileSync(path.join(dir, fn, f), body);
      }
    }
    const r = spawnSync(process.execPath, [CHECK], { env: { ...process.env, CHECK_WRITE_GUARD_FN_DIR: dir, CHECK_WRITE_GUARD_MANIFEST: path.join(dir, "manifest.json") }, encoding: "utf8" });
    return { code: r.status, out: r.stdout + r.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const both = (djSrc) => ({ "deal-jacket-pipeline": djSrc, "forensic-deal-jacket": GATED });

test("gate as a top-level statement before the body is read → pass", () => {
  assert.equal(run(both(GATED)).code, 0);
});

test("isServiceCaller form, block body → pass", () => {
  const src = head + `  if (!(await isServiceCaller(req))) {
    return new Response("no", { status: 403 });
  }
` + tail;
  assert.equal(run(both(src)).code, 0);
});

test("skeptic2 mutant (a): the gate only in a trailing comment → fail", () => {
  const src = (head + tail).replace("return new Response(\"ok\");", "return new Response(\"ok\"); // TODO: gate with requireOwnerOrService(req)");
  const r = run(both(src));
  assert.equal(r.code, 1);
  assert.match(r.out, /deal-jacket-pipeline/);
});

test("skeptic2 mutant (b): a non-gating isServiceCaller after the write → fail", () => {
  const src = (head + tail).replace("  return new Response(\"ok\");", "  console.log(await isServiceCaller(req));\n  return new Response(\"ok\");");
  refusedScoped(run(both(src)));
});

test("gate called after req.json() → fail", () => {
  const src = head + tail.replace("  const body = await req.json();\n", "  const body = await req.json();\n  const notOwner = await requireOwnerOrService(req);\n  if (notOwner) return notOwner;\n");
  refusedScoped(run(both(src)));
});

test("gate result computed but never returned → fail", () => {
  const src = head + "  const notOwner = await requireOwnerOrService(req);\n  console.log(notOwner);\n" + tail;
  refusedScoped(run(both(src)));
});

test("gate only inside another condition → fail", () => {
  const src = head + "  if (Date.now() < 0) { const n = await requireOwnerOrService(req); if (n) return n; }\n" + tail;
  refusedScoped(run(both(src)));
});

test("a classed function renamed away → fail (stale entry)", () => {
  const r = run({ "forensic-deal-jacket": GATED });
  assert.equal(r.code, 1);
  assert.match(r.out, /caller-class entry has no function directory: deal-jacket-pipeline/);
});

const OPEN = head + tail; // requireWriteAuth only: any signed-in stranger
const GATE_LINE = "  const g = await requireOwnerOrService(req); if (g) return g;\n";

test("skeptic2 mutant (a): the gate only in a dead file beside index.ts → fail", () => {
  refusedScoped(run(both({ "index.ts": OPEN, "zz_unused.ts": GATE_LINE })));
});

test("skeptic2 mutant (b): the gate only in an unused function above the handler → fail", () => {
  const src = OPEN.replace("Deno.serve(", "async function unused(req: Request) {\n" + GATE_LINE + "}\nDeno.serve(");
  refusedScoped(run(both(src)));
});

test("skeptic2 mutant (c): the gate inside if (GET) at 4 spaces → fail", () => {
  const src = head + '  if (req.method === "GET") {\n  ' + GATE_LINE + "  }\n" + tail;
  refusedScoped(run(both(src)));
});

test("a call that hands req to other code before the gate → fail", () => {
  const src = head + "  const early = await other(req);\n" + GATE_LINE + tail;
  refusedScoped(run(both(src)));
});

test("an early return before the gate → fail", () => {
  const src = head + "  if (Date.now() > 0) return new Response(\"x\");\n" + GATE_LINE + tail;
  refusedScoped(run(both(src)));
});

test("OPTIONS return before the gate → pass", () => {
  const src = head + '  if (req.method === "OPTIONS") {\n    return new Response(null);\n  }\n' + GATE_LINE + tail;
  assert.equal(run(both(src)).code, 0);
});

test("exported handler served under import.meta.main, gate first → pass", () => {
  const src = `import { requireOwnerOrService, requireWriteAuth } from "../_shared/writeGuard.ts";
${CLIENT}export async function handler(req: Request): Promise<Response> {
  const denied = await requireWriteAuth(req);
  if (denied) return denied;
  const notOwner = await requireOwnerOrService(req);
  if (notOwner) return notOwner;
  if (req.method === "OPTIONS") return new Response(null);
  const body = await req.json();
  await supabase.from("vehicle_images").update({ vehicle_id: body.v }).eq("id", body.i);
  return new Response("ok");
}
if (import.meta.main) Deno.serve(handler);
`;
  assert.equal(run(both(src)).code, 0);
});

test("exported handler served under import.meta.main, gate only in a helper → fail", () => {
  const src = `import { requireOwnerOrService, requireWriteAuth } from "../_shared/writeGuard.ts";
${CLIENT}async function check(req: Request) {
  const notOwner = await requireOwnerOrService(req);
  if (notOwner) return notOwner;
}
export async function handler(req: Request): Promise<Response> {
  const denied = await requireWriteAuth(req);
  if (denied) return denied;
  if (req.method === "OPTIONS") return new Response(null);
  const body = await req.json();
  await supabase.from("vehicle_images").update({ vehicle_id: body.v }).eq("id", body.i);
  return new Response("ok");
}
if (import.meta.main) Deno.serve(handler);
`;
  refusedScoped(run(both(src)));
});

test("a brace inside a string does not end the handler early → pass", () => {
  const src = head + GATE_LINE + tail.replace('return new Response("ok");', 'return new Response("}{");');
  assert.equal(run(both(src)).code, 0);
});

// Caller classes beyond service.
const withRow = (fn, row) => ({ ...DEFAULT_MANIFEST, functions: { ...DEFAULT_MANIFEST.functions, [fn]: row } });
const three = (src) => ({ ...both(GATED), "image-thing": src });

test("a service-client writer with no caller class → fail", () => {
  const r = run(three(OPEN));
  assert.equal(r.code, 1);
  assert.match(r.out, /image-thing: no caller class/);
});

test("self with a reason → pass; self without one → fail", () => {
  assert.equal(run(three(OPEN), withRow("image-thing", { class: "self", reason: "keyed to the caller's JWT id" })).code, 0);
  assert.match(run(three(OPEN), withRow("image-thing", { class: "self", reason: "" })).out, /image-thing: class self needs a reason/);
});

test("row_owner open within the ceiling → pass; over it → fail", () => {
  const row = { class: "row_owner", owns: "image_id", status: "open", reason: "PR 2" };
  assert.equal(run(three(OPEN), { ...withRow("image-thing", row), open_ceiling: 1 }).code, 0);
  assert.match(run(three(OPEN), withRow("image-thing", row)).out, /1 open rows exceed open_ceiling 0/);
});

test("row_owner closed without a requireCallerCan* helper → fail; with one → pass", () => {
  const row = { class: "row_owner", owns: "image_id", reason: "owner-checked" };
  assert.match(run(three(OPEN), withRow("image-thing", row)).out, /calls no requireCallerCan\* ownership helper/);
  const helped = head + "  const no = await requireCallerCanEditImage(req, 'x'); if (no) return no;\n" + tail;
  assert.equal(run(three(helped), withRow("image-thing", row)).code, 0);
});

test("by_mode needs service_modes and a gate somewhere", () => {
  const row = { class: "by_mode", service_modes: ["queue"], reason: "single image is owner-checked" };
  assert.match(run(three(OPEN), withRow("image-thing", row)).out, /class by_mode, but no service gate on any mode/);
  const moded = head + '  if (mode === "queue") { const n = await requireAdminOrService(req); if (n) return n; }\n' + tail;
  assert.equal(run(three(moded), withRow("image-thing", row)).code, 0);
  assert.match(run(three(moded), withRow("image-thing", { ...row, service_modes: [] })).out, /must list service_modes/);
});

test("a relay (service key, calls another function) outside service must say how it checks → fail without relay", () => {
  const relay = head + tail.replace("  const body = await req.json();\n",
    "  const body = await req.json();\n  await fetch(`${url}/functions/v1/other-fn`, { headers: { Authorization: `Bearer ${projectSecretKey()}` }, body: JSON.stringify(body) });\n");
  const row = { class: "public", reason: "fixture" };
  assert.match(run(three(relay), withRow("image-thing", row)).out, /image-thing: class public calls other-fn holding the service key/);
  assert.equal(run(three(relay), withRow("image-thing", { ...row, relay: "forwards the caller's JWT; checks user_can_edit_vehicle first" })).code, 0);
});

test("a service row cannot be open", () => {
  assert.match(run(both(GATED), withRow("deal-jacket-pipeline", { ...SERVICE_ROW, status: "open" }), ).out, /a service row cannot be open/);
});

test("gate as the first statement of the handler's leading try → pass", () => {
  const src = head + "  try {\n    if (!(await isServiceCaller(req))) {\n      return new Response('no', { status: 401 });\n    }\n" +
    tail.replace("});\n", "  } catch (e) { return new Response('x'); }\n});\n");
  assert.equal(run(both(src)).code, 0);
});

test("a wrong-method refusal before the gate → pass", () => {
  const src = head + '  if (req.method !== "POST") return new Response(null, { status: 405 });\n' + GATE_LINE + tail;
  assert.equal(run(both(src)).code, 0);
});

test("requireWriteAuth ?? requireAdminOrService in one statement → pass", () => {
  const src = head.replace("  const denied = await requireWriteAuth(req);\n  if (denied) return denied;\n",
    "  const denied = (await requireWriteAuth(req, { headers: h })) ??\n    (await requireAdminOrService(req, { headers: h }));\n  if (denied) return denied;\n") + tail;
  assert.equal(run(both(src)).code, 0);
});
