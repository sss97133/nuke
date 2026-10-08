import { drainRetainedReferenceQueue } from "./retainedReferenceQueue.ts";
const assert = (ok: unknown) => {
  if (!ok) throw new Error("assertion failed");
};
const VID = "10000000-0000-0000-0000-000000000001",
  OBS = "40000000-0000-0000-0000-000000000001";
const body = {
  use_retained_reference_queue: true,
  dry_run: false,
  batch_size: 20,
};
async function run(
  options: Record<string, unknown> = body,
  scenario = "success",
) {
  const calls: any[] = [], originalFetch = globalThis.fetch;
  const oldUrl = Deno.env.get("SUPABASE_URL"),
    oldKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  Deno.env.set("SUPABASE_URL", "https://db.test");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");
  const supabase = {
    rpc: (name: string, args: any) => ({
      abortSignal: async () => {
        calls.push({ name, args });
        return name === "claim_vin_reference_intake"
          ? {
            data: scenario === "empty"
              ? []
              : [{ revision_id: "7", vehicle_id: VID }],
            error: scenario === "claim_error" ? {} : null,
          }
          : { data: scenario !== "cas_failure", error: null };
      },
    }),
  };
  globalThis.fetch = async (request, opts) => {
    const init = opts as { body?: unknown } | undefined;
    calls.push({
      request: String(request),
      payload: JSON.parse(String(init?.body)),
    });
    if (scenario === "network_error") throw new Error("unavailable");
    const out: any = {
      success: true,
      dry_run: false,
      model_calls: 0,
      writes: scenario === "duplicate" ? 0 : 1,
      observation_id: OBS,
      vehicle_id: VID,
      requested_taxonomy_revision_id: "7",
      physical_configuration_verified: false,
      receipt: {
        method: "protected_retained_vin_reference_v1",
        role: "factory_reference",
        vehicle_id: VID,
        physical_configuration_verified: false,
      },
    };
    if (scenario === "wrong_receipt") out.requested_taxonomy_revision_id = "8";
    if (scenario === "physical_claim") {
      out.receipt.physical_configuration_verified = true;
    }
    return new Response(
      JSON.stringify(
        scenario === "refused" ? { reason: "reference_error_code" } : out,
      ),
      { status: scenario === "refused" ? 422 : 200 },
    );
  };
  try {
    const response = await drainRetainedReferenceQueue(supabase, options);
    return { status: response.status, data: await response.json(), calls };
  } finally {
    globalThis.fetch = originalFetch;
    oldUrl === undefined
      ? Deno.env.delete("SUPABASE_URL")
      : Deno.env.set("SUPABASE_URL", oldUrl);
    oldKey === undefined
      ? Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY")
      : Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", oldKey);
  }
}
Deno.test("retained worker demands explicit bounded mode before any claim", async () => {
  for (
    const invalid of [
      { ...body, dry_run: true },
      { ...body, batch_size: 21 },
      { ...body, batch_size: NaN },
      { ...body, batch_size: "20" },
      { ...body, offset: 1 },
    ]
  ) {
    const r = await run(invalid);
    assert(r.status === 400 && r.calls.length === 0);
  }
});
Deno.test("retained worker calls canonical selector, finalizes persisted result and never calls provider", async () => {
  for (const scenario of ["success", "duplicate"]) {
    const r = await run(body, scenario);
    assert(
      r.status === 200 && r.data.stored === 1 &&
        r.data.writes === (scenario === "duplicate" ? 0 : 1) &&
        r.data.provider_calls === 0 && r.data.model_calls === 0,
    );
    assert(
      r.calls[1].request ===
          "https://db.test/functions/v1/ingest-observation" &&
        r.calls[1].payload.revision_id === "7",
    );
    assert(
      r.calls[2].args.p_status === "done" &&
        r.calls[2].args.p_observation === OBS,
    );
  }
});
Deno.test("semantic refusal rechecks, transient errors retry, invalid receipts cannot complete", async () => {
  for (
    const scenario of [
      "refused",
      "network_error",
      "wrong_receipt",
      "physical_claim",
    ]
  ) {
    const r = await run(body, scenario);
    assert(
      r.data.writes === 0 &&
        r.calls[2].args.p_status ===
          (scenario === "refused" ? "skipped" : "retry") &&
        r.calls[2].args.p_observation === null,
    );
  }
});
Deno.test("HTTP success without completion CAS reports unverified writes", async () => {
  const r = await run(body, "cas_failure");
  assert(
    r.status === 503 && r.data.writes_reported === 1 && r.data.writes === 0 &&
      r.data.completion_failures === 1,
  );
});
Deno.test("claim failure and empty queue require no HTTP intake", async () => {
  const failed = await run(body, "claim_error");
  assert(failed.status === 503 && failed.calls.length === 1);
  const empty = await run(body, "empty");
  assert(
    empty.status === 200 && empty.data.claimed === 0 &&
      empty.calls.length === 1,
  );
});
