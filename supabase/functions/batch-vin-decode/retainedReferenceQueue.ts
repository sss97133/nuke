import {
  RETAINED_VIN_METHOD,
  RETAINED_VIN_MODE,
  retainedVinSelector,
} from "../ingest-observation/retainedVinReference.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });

/** This lane reads retained evidence through canonical intake; never calls vPIC. */
export async function drainRetainedReferenceQueue(
  supabase: any,
  body: Record<string, unknown>,
): Promise<Response> {
  if (
    Object.keys(body).some((k) =>
      !["use_retained_reference_queue", "dry_run", "batch_size"].includes(k)
    ) ||
    body.use_retained_reference_queue !== true || body.dry_run !== false ||
    (body.batch_size !== undefined && (!Number.isInteger(body.batch_size) ||
      Number(body.batch_size) < 1 || Number(body.batch_size) > 60))
  ) {
    return json({
      success: false,
      error: "retained_queue_requires_explicit_bounded_write",
      writes: 0,
      model_calls: 0,
    }, 400);
  }
  const worker = `vin-reference-${crypto.randomUUID()}`, started = Date.now();
  const { data: items, error } = await supabase.rpc(
    "claim_vin_reference_intake",
    {
      p_worker: worker,
      p_limit: body.batch_size ?? 20,
    },
  ).abortSignal(AbortSignal.timeout(10000));
  if (
    error || !Array.isArray(items) ||
    items.length > Number(body.batch_size ?? 20)
  ) {
    return json({
      success: false,
      error: "retained_queue_claim_failed",
      writes: 0,
      model_calls: 0,
    }, 503);
  }
  let stored = 0,
    refused = 0,
    retries = 0,
    reported = 0,
    writes = 0,
    completionFailures = 0;
  const results: Record<string, unknown>[] = [];
  for (const item of items) {
    let status = "retry",
      reason = "intake_request_failed",
      observation: string | null = null,
      recordWrites = 0;
    const revision = retainedVinSelector({
      mode: RETAINED_VIN_MODE,
      revision_id: item.revision_id,
      dry_run: false,
    });
    if (Date.now() - started >= 40000) reason = "batch_budget_deferred";
    else if (!revision || !UUID.test(item.vehicle_id ?? "")) {
      reason = "queue_locator_invalid";
    } else {
      try {
        const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
          url = Deno.env.get("SUPABASE_URL");
        if (!key || !url) throw new Error("credential_unavailable");
        const response = await fetch(`${url}/functions/v1/ingest-observation`, {
          method: "POST",
          signal: AbortSignal.timeout(
            Math.max(1, Math.min(10000, 45000 - (Date.now() - started))),
          ),
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${key}`,
            apikey: key,
            "x-nuke-internal": key,
          },
          body: JSON.stringify({
            mode: RETAINED_VIN_MODE,
            revision_id: revision,
            dry_run: false,
          }),
        });
        const out = await response.json().catch(() => null);
        if (
          response.ok && out?.success === true && out.dry_run === false &&
          out.model_calls === 0 &&
          (out.writes === 0 || out.writes === 1) &&
          UUID.test(out.observation_id ?? "") &&
          out.requested_taxonomy_revision_id === revision &&
          out.vehicle_id === item.vehicle_id &&
          out.receipt?.vehicle_id === item.vehicle_id &&
          out.receipt.method === RETAINED_VIN_METHOD &&
          out.receipt.role === "factory_reference" &&
          out.receipt.physical_configuration_verified === false &&
          out.physical_configuration_verified === false
        ) {
          status = "done";
          reason = "";
          observation = out.observation_id;
          recordWrites = out.writes;
        } else if (
          response.status === 422 && typeof out?.reason === "string" &&
          /^[a-z][a-z0-9_]{0,100}$/.test(out.reason)
        ) {
          status = "skipped";
          reason = out.reason;
        } else reason = "intake_http_or_receipt_failed";
      } catch {
        reason = "intake_request_failed";
      }
    }
    reported += recordWrites;
    try {
      const { data: completed, error: finishError } = await supabase.rpc(
        "finish_vin_reference_intake",
        {
          p_revision: item.revision_id,
          p_worker: worker,
          p_status: status,
          p_observation: observation,
          p_reason: reason || null,
        },
      ).abortSignal(
        AbortSignal.timeout(
          Math.max(1, Math.min(5000, 55000 - (Date.now() - started))),
        ),
      );
      if (finishError || completed !== true) {
        throw new Error("completion_unverified");
      }
    } catch {
      completionFailures++;
      results.push({
        revision_id: item.revision_id,
        status: "completion_unverified",
      });
      break;
    }
    if (status === "done") {
      stored++;
      writes += recordWrites;
    } else if (status === "skipped") refused++;
    else retries++;
    results.push({
      revision_id: item.revision_id,
      status,
      ...(reason ? { reason } : {}),
      ...(observation ? { observation_id: observation } : {}),
    });
  }
  return json({
    success: completionFailures === 0,
    use_retained_reference_queue: true,
    dry_run: false,
    claimed: items.length,
    stored,
    refused,
    retries,
    completion_failures: completionFailures,
    writes_reported: reported,
    writes,
    model_calls: 0,
    provider_calls: 0,
    duration_ms: Date.now() - started,
    results,
  }, completionFailures ? 503 : 200);
}
