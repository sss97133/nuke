import {
  ingestRetainedVinBatch,
  RETAINED_VIN_BATCH_MODE,
} from "./retainedVinBatch.ts";
const assert = (ok: unknown) => {
  if (!ok) throw new Error("assertion failed");
};

Deno.test("canonical batch budget defers unstarted selectors and transports no raw receipt", async () => {
  const originalNow = Date.now;
  let elapsed = 0, calls = 0;
  Date.now = () => originalNow() + elapsed;
  try {
    const response = await ingestRetainedVinBatch(
      new Request("https://intake.test"),
      {
        mode: RETAINED_VIN_BATCH_MODE,
        dry_run: false,
        revision_ids: Array.from({ length: 120 }, (_, i) => String(i + 7)),
      },
      async (req) => {
        const body = await req.json();
        calls++;
        elapsed = 35001;
        return Response.json({
          success: true,
          dry_run: false,
          writes: 1,
          model_calls: 0,
          requested_taxonomy_revision_id: body.revision_id,
          receipt: {
            method: "protected_retained_vin_reference_v1",
            role: "factory_reference",
            raw_reference: {
              private_fixture: "must stay in canonical receipt",
            },
          },
        });
      },
    );
    const out = await response.json();
    assert(calls === 1 && out.results.length === 120);
    assert(out.results[0].body.receipt.raw_reference === undefined);
    assert(
      out.results.slice(1).every((x: any) =>
        x.status_code === 503 && x.body.reason === "batch_budget_deferred"
      ),
    );
  } finally {
    Date.now = originalNow;
  }
});
