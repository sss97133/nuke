import { runPostClassifierStage, type PostClassifierDeps } from "./postClassifier.ts";
import type { StageReceiptArgs } from "./stageReceipts.ts";
import type { WorkItem } from "./stageWorker.ts";

function assert(v: unknown): asserts v { if (!v) throw new Error("assertion failed"); }
const item: WorkItem = { work_id: 1, image_id: "img1", image_url: "u", user_id: "usr", vehicle_id: null, lane: "backfill" };
const cls = { image_type: "vehicle_exterior", vin_detected: null };

function deps(o: { saved?: Awaited<ReturnType<PostClassifierDeps["loadSaved"]>>; latest?: Record<string, string | null>; fileVehicle?: () => Promise<string | null>;
  gather?: () => Promise<void> } = {}) {
  const calls: string[] = []; const receipts: StageReceiptArgs[] = [];
  const d: PostClassifierDeps = {
    loadSaved: async () => { calls.push("load"); return o.saved === undefined ? { classification: cls, vehicle_id: null, image_url: "u2" } : o.saved; },
    latestOutcome: async (_i, stage) => o.latest?.[stage] ?? null,
    fileVehicle: async () => { calls.push("file"); return o.fileVehicle ? await o.fileVehicle() : "veh1"; },
    gatherEvidence: async (_it, url, veh) => { calls.push(`gather:${url}:${veh}`); if (o.gather) await o.gather(); },
    markCompleted: async () => { calls.push("complete"); },
    record: async (r) => { if (r) receipts.push(r); return true; },
  };
  return { d, calls, receipts };
}

Deno.test("no dependency can reach the classifier (the runner's whole surface has no classify hook)", () => {
  const { d } = deps();
  assert(!Object.keys(d).some((k) => /classif/i.test(k) && k !== "loadSaved"));
});

Deno.test("filing success then evidence continues from the saved classification, one receipt per stage", async () => {
  const { d, calls, receipts } = deps();
  const r = await runPostClassifierStage(d, "filing", item);
  assert(r.ok);
  assert(calls.join() === "load,file,gather:u2:veh1,complete");
  assert(receipts.map((x) => `${x.p_stage}:${x.p_outcome}`).join() === "filing:succeeded,evidence:succeeded");
  assert(!receipts.some((x) => x.p_stage === "classifier"));
});

Deno.test("filing retry does not repeat evidence that already succeeded", async () => {
  const { d, calls, receipts } = deps({ latest: { evidence: "succeeded" } });
  const r = await runPostClassifierStage(d, "filing", item);
  assert(r.ok && !calls.some((c) => c.startsWith("gather")) && receipts.length === 1);
});

Deno.test("an already-filed photo is not re-filed", async () => {
  const { d, calls } = deps({ saved: { classification: cls, vehicle_id: "veh9", image_url: "u" } });
  await runPostClassifierStage(d, "filing", item);
  assert(!calls.includes("file") && calls.includes("gather:u:veh9"));
});

Deno.test("filing throw -> failed receipt on filing with a typed class, evidence not attempted", async () => {
  const { d, calls, receipts } = deps({ fileVehicle: async () => { throw new Error("x"); } });
  const r = await runPostClassifierStage(d, "filing", item);
  assert(!r.ok && receipts.length === 1);
  assert(receipts[0].p_stage === "filing" && receipts[0].p_outcome === "failed" && receipts[0].p_error_class === "photo_pipeline_attribution_failed");
  assert(receipts[0].p_retry_after_seconds === null);   // the backoff is chosen server-side by record_image_stage_receipt
  assert(!calls.some((c) => c.startsWith("gather")));
});

Deno.test("evidence throw -> failed receipt on evidence only (filing is not re-receipted)", async () => {
  const { d, receipts, calls } = deps({ gather: async () => { throw new Error("x"); } });
  const r = await runPostClassifierStage(d, "evidence", item);
  assert(!r.ok && receipts.length === 1 && receipts[0].p_stage === "evidence" && receipts[0].p_outcome === "failed");
  assert(!calls.includes("complete"));
});

Deno.test("evidence run while filing is still failed is refused with a retryable failed receipt", async () => {
  const { d, calls, receipts } = deps({ latest: { filing: "failed" } });
  const r = await runPostClassifierStage(d, "evidence", item);
  assert(!r.ok && receipts[0].p_error_class === "filing_not_settled" && receipts[0].p_outcome === "failed");
  assert(!calls.some((c) => c.startsWith("gather")));
});

Deno.test("evidence success marks the image completed", async () => {
  const { d, calls, receipts } = deps();
  const r = await runPostClassifierStage(d, "evidence", item);
  assert(r.ok && calls.includes("complete") && receipts[0].p_outcome === "succeeded");
});

Deno.test("no saved classification -> terminal blocked_input receipt, nothing is run", async () => {
  for (const saved of [{ classification: null, vehicle_id: null, image_url: "u" }, null]) {
    const { d, calls, receipts } = deps({ saved });
    const r = await runPostClassifierStage(d, "evidence", item);
    assert(!r.ok && receipts.length === 1 && receipts[0].p_outcome === "blocked_input" && receipts[0].p_error_class === "no_saved_classification");
    assert(!calls.some((c) => c.startsWith("gather") || c === "file"));
  }
});

Deno.test("a read failure writes no receipt and does not throw (lease expiry requeues, attempt-capped)", async () => {
  const { d, receipts } = deps();
  d.loadSaved = async () => { throw new Error("db"); };
  const r = await runPostClassifierStage(d, "filing", item);
  assert(!r.ok && receipts.length === 0);
});

Deno.test("other stages are refused", async () => {
  const { d, receipts } = deps();
  const r = await runPostClassifierStage(d, "classifier", item);
  assert(!r.ok && receipts.length === 0);
});
