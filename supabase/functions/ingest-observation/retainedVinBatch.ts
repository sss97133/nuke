import {
  RETAINED_VIN_MODE,
  retainedVinSelector,
} from "./retainedVinReference.ts";

export const RETAINED_VIN_BATCH_MODE = "retained_vin_reference_batch_v1";

/** Source selectors only. Each record still enters the same canonical handler. */
export async function ingestRetainedVinBatch(
  req: Request,
  input: Record<string, unknown>,
  admit: (request: Request) => Promise<Response>,
): Promise<Response> {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  const ids = Array.isArray(input.revision_ids) ? input.revision_ids : [];
  const selectors = ids.map((id) =>
    retainedVinSelector({
      mode: RETAINED_VIN_MODE,
      revision_id: id,
      dry_run: false,
    })
  );
  if (
    input.mode !== RETAINED_VIN_BATCH_MODE || input.dry_run !== false ||
    Object.keys(input).some((key) =>
      !["mode", "revision_ids", "dry_run"].includes(key)
    ) ||
    ids.length < 1 || ids.length > 60 || selectors.some((id) => id === null) ||
    new Set(selectors).size !== selectors.length
  ) {
    return json({
      success: false,
      error: "invalid_bounded_vin_batch",
      writes: 0,
      model_calls: 0,
    }, 400);
  }
  const started = Date.now(), results = [];
  for (const revision of selectors) {
    if (req.signal.aborted || Date.now() - started >= 35000) {
      results.push({
        revision_id: revision,
        status_code: 503,
        body: { reason: "batch_budget_deferred" },
      });
      continue;
    }
    try {
      const response = await admit(
        new Request(req.url, {
          method: "POST",
          headers: req.headers,
          signal: req.signal,
          body: JSON.stringify({
            mode: RETAINED_VIN_MODE,
            revision_id: revision,
            dry_run: false,
          }),
        }),
      );
      const out = await response.json();
      // The canonical fact retains the complete receipt. Transport needs only
      // the acknowledgement; database completion independently verifies it.
      const body = response.status === 200
        ? {
          success: out.success,
          dry_run: out.dry_run,
          writes: out.writes,
          model_calls: out.model_calls,
          observation_id: out.observation_id,
          vehicle_id: out.vehicle_id,
          requested_taxonomy_revision_id: out.requested_taxonomy_revision_id,
          physical_configuration_verified: out.physical_configuration_verified,
          receipt: out.receipt &&
            {
              method: out.receipt.method,
              role: out.receipt.role,
              vehicle_id: out.receipt.vehicle_id,
              physical_configuration_verified:
                out.receipt.physical_configuration_verified,
            },
        }
        : {
          reason: response.status === 422
            ? out.reason
            : "canonical_record_request_failed",
        };
      results.push({
        revision_id: revision,
        status_code: response.status,
        body,
      });
    } catch {
      results.push({
        revision_id: revision,
        status_code: 503,
        body: { reason: "canonical_record_request_failed" },
      });
    }
  }
  return json({
    success: true,
    mode: RETAINED_VIN_BATCH_MODE,
    dry_run: false,
    model_calls: 0,
    provider_calls: 0,
    results,
  });
}
