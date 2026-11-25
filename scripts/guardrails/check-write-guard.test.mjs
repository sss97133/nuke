// Fixture tests for check-write-guard's service-scoped rule:  node --test scripts/guardrails/check-write-guard.test.mjs
// Each case writes a tiny functions tree (the two service-scoped functions plus an empty _shared) and runs the check
// against it through CHECK_WRITE_GUARD_FN_DIR.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CHECK = path.join(path.dirname(fileURLToPath(import.meta.url)), "check-write-guard.mjs");

const head = `import { requireOwnerOrService, isServiceCaller, requireWriteAuth } from "../_shared/writeGuard.ts";
Deno.serve(async (req) => {
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

// The service-scoped refusal names the function under the "refuse signed-in strangers" heading.
const SCOPED = /service-scoped function\(s\) admit any signed-in caller:\n  deal-jacket-pipeline /;
function refusedScoped(r) {
  assert.equal(r.code, 1);
  assert.match(r.out, SCOPED);
}
function run(files) {
  const dir = mkdtempSync(path.join(tmpdir(), "cwg-"));
  try {
    mkdirSync(path.join(dir, "_shared"));
    for (const [fn, src] of Object.entries(files)) {
      mkdirSync(path.join(dir, fn));
      // a string is index.ts; an object maps file names to sources
      for (const [f, body] of Object.entries(typeof src === "string" ? { "index.ts": src } : src)) {
        writeFileSync(path.join(dir, fn, f), body);
      }
    }
    const r = spawnSync(process.execPath, [CHECK], { env: { ...process.env, CHECK_WRITE_GUARD_FN_DIR: dir }, encoding: "utf8" });
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

test("a service-scoped function renamed away → fail (stale entry)", () => {
  const r = run({ "forensic-deal-jacket": GATED });
  assert.equal(r.code, 1);
  assert.match(r.out, /no function directory: deal-jacket-pipeline/);
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
export async function handler(req: Request): Promise<Response> {
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
async function check(req: Request) {
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
