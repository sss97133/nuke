import { persistPipelineState, type MetadataStore, type PipelineReceipt } from "./persistence.ts";

function assert(value: unknown): asserts value { if (!value) throw new Error("assertion failed"); }
const base: PipelineReceipt = {
  receipt_id: "attempt:image:failed", attempt_id: "attempt", image_id: "image", method: "photo-pipeline-orchestrator",
  pipeline_version: "v2", receipt_version: 1, outcome: "failed",
  processing_started_at: "2026-10-02T00:00:00.000Z", processing_finished_at: "2026-10-02T00:00:01.000Z",
  failure_phase: "classification", error_class: "classifier_rate_limited", classifier_attempts: 5,
};

function fixture() {
  let metadata: Record<string, unknown> = {
    byok_deep_analysis: { verdict: "kept" }, on_device_vision: { model: "local-v1" },
    provenance_corrections: { source: "kept" }, duplicate_collapse: { keeper: "other-image" },
  };
  let version = "initial", writes = 0;
  const store: MetadataStore = {
    async read() { return { metadata: structuredClone(metadata), updated_at: version }; },
    async compareAndSwap(snapshot, patch) {
      if (snapshot.updated_at !== version) return false;
      metadata = patch.ai_scan_metadata as Record<string, unknown>; version = `v${++writes}`; return true;
    },
  };
  return { store, get metadata() { return metadata; }, get writes() { return writes; },
    concurrentUpdate() { metadata = { ...metadata, on_device_vision: { model: "local-v2" } }; version = "concurrent"; } };
}

for (const outcome of ["failed", "completed", "policy_skip"] as const) {
  Deno.test(`${outcome} preserves all other producers' metadata and capture clocks`, async () => {
    const f = fixture(); let patch: Record<string, unknown> = {};
    const cas = f.store.compareAndSwap;
    f.store.compareAndSwap = (snapshot, value) => { patch = value; return cas(snapshot, value); };
    await persistPipelineState(f.store, { ...base, outcome }, { ai_processing_status: outcome === "failed" ? "failed" : "completed" }, { classifier_failed: outcome === "failed" });
    assert(JSON.stringify(f.metadata.byok_deep_analysis).includes("kept"));
    assert(JSON.stringify(f.metadata.on_device_vision).includes("local-v1"));
    assert(f.metadata.provenance_corrections && f.metadata.duplicate_collapse);
    assert(!("taken_at" in patch) && !("created_at" in patch));
  });
}

Deno.test("concurrent sibling update causes re-read and survives final receipt", async () => {
  const f = fixture(); const cas = f.store.compareAndSwap; let calls = 0;
  f.store.compareAndSwap = (snapshot, patch) => { if (++calls === 1) f.concurrentUpdate(); return cas(snapshot, patch); };
  await persistPipelineState(f.store, base, { ai_processing_status: "failed" });
  assert(calls === 2 && f.writes === 1 && JSON.stringify(f.metadata.on_device_vision).includes("local-v2"));
});

Deno.test("replayed receipt does not write again", async () => {
  const f = fixture(); await persistPipelineState(f.store, base, { ai_processing_status: "failed" });
  await persistPipelineState(f.store, base, { ai_processing_status: "failed" }); assert(f.writes === 1);
});

Deno.test("later processing and success preserve the prior failure receipt", async () => {
  const f = fixture(); await persistPipelineState(f.store, base, { ai_processing_status: "failed" });
  await persistPipelineState(f.store, { ...base, receipt_id: "next:processing", attempt_id: "next", outcome: "processing", processing_started_at: "2026-10-02T00:02:00.000Z" }, { ai_processing_status: "processing" });
  await persistPipelineState(f.store, { ...base, receipt_id: "next:completed", attempt_id: "next", outcome: "completed", processing_started_at: "2026-10-02T00:02:00.000Z" }, { ai_processing_status: "completed" });
  const ns = f.metadata.photo_pipeline as Record<string, PipelineReceipt>;
  assert(ns.last_failure.receipt_id === base.receipt_id && ns.last_success.receipt_id === "next:completed");
});

Deno.test("older completion cannot overwrite a newer successful attempt", async () => {
  const f = fixture(); await persistPipelineState(f.store, { ...base, receipt_id: "new", attempt_id: "new", outcome: "completed", processing_started_at: "2026-10-02T00:03:00.000Z" }, { ai_processing_status: "completed" });
  let rejected = false; try { await persistPipelineState(f.store, base, { ai_processing_status: "failed" }); } catch (e) { rejected = e instanceof Error && e.message === "photo_pipeline_stale_attempt"; }
  assert(rejected && f.writes === 1);
});

Deno.test("write rejection never becomes a persistence success", async () => {
  const f = fixture(); f.store.compareAndSwap = async () => { throw new Error("rejected"); };
  let rejected = false; try { await persistPipelineState(f.store, base, {}); } catch { rejected = true; }
  assert(rejected && f.writes === 0);
});

Deno.test("concurrency conflicts stop after three attempts", async () => {
  const f = fixture(); let calls = 0; f.store.compareAndSwap = async () => { calls++; return false; };
  let rejected = false; try { await persistPipelineState(f.store, base, {}); } catch { rejected = true; }
  assert(rejected && calls === 3 && f.writes === 0);
});

Deno.test("equal-clock different attempt cannot overwrite the current claim", async () => {
  const f = fixture();
  await persistPipelineState(f.store, { ...base, receipt_id: "current:processing", attempt_id: "current", outcome: "processing" }, { ai_processing_status: "processing" });
  let rejected = false;
  try { await persistPipelineState(f.store, base, { ai_processing_status: "failed" }); }
  catch (e) { rejected = e instanceof Error && e.message === "photo_pipeline_stale_attempt"; }
  assert(rejected && f.writes === 1);
});

Deno.test("canonical URL or vehicle reassignment stops a stale classification patch", async () => {
  for (const changed of [{ image_url: "new-url", vehicle_id: "vehicle" }, { image_url: "original-url", vehicle_id: "new-vehicle" }]) {
    const f = fixture(); const read = f.store.read;
    f.store.read = async () => ({ ...await read(), ...changed });
    let rejected = false;
    try { await persistPipelineState(f.store, base, { vehicle_id: "old-vehicle" }, {}, { image_url: "original-url", vehicle_id: "vehicle" }); }
    catch (e) { rejected = e instanceof Error && e.message === "photo_pipeline_source_changed"; }
    assert(rejected && f.writes === 0);
  }
});

Deno.test("read failure cannot become persistence success", async () => {
  const f = fixture(); f.store.read = async () => { throw new Error("row unavailable"); };
  let rejected = false; try { await persistPipelineState(f.store, base, {}); } catch { rejected = true; }
  assert(rejected && f.writes === 0);
});
