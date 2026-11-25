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

function run(files) {
  const dir = mkdtempSync(path.join(tmpdir(), "cwg-"));
  try {
    mkdirSync(path.join(dir, "_shared"));
    for (const [fn, src] of Object.entries(files)) {
      mkdirSync(path.join(dir, fn));
      writeFileSync(path.join(dir, fn, "index.ts"), src);
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
  assert.equal(run(both(src)).code, 1);
});

test("gate called after req.json() → fail", () => {
  const src = head + tail.replace("  const body = await req.json();\n", "  const body = await req.json();\n  const notOwner = await requireOwnerOrService(req);\n  if (notOwner) return notOwner;\n");
  assert.equal(run(both(src)).code, 1);
});

test("gate result computed but never returned → fail", () => {
  const src = head + "  const notOwner = await requireOwnerOrService(req);\n  console.log(notOwner);\n" + tail;
  assert.equal(run(both(src)).code, 1);
});

test("gate only inside another condition → fail", () => {
  const src = head + "  if (Date.now() < 0) { const n = await requireOwnerOrService(req); if (n) return n; }\n" + tail;
  assert.equal(run(both(src)).code, 1);
});

test("a service-scoped function renamed away → fail (stale entry)", () => {
  const r = run({ "forensic-deal-jacket": GATED });
  assert.equal(r.code, 1);
  assert.match(r.out, /no function directory: deal-jacket-pipeline/);
});
