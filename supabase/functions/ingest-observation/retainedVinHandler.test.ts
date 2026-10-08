import {
  qualifyRetainedVinReference,
  RETAINED_VIN_METHOD,
  RETAINED_VIN_MODE,
} from "./retainedVinReference.ts";
import { observationContentHash } from "../_shared/observationContentHash.ts";
import { RETAINED_VIN_BATCH_MODE } from "./retainedVinBatch.ts";
const assert = (ok: unknown, message = "assertion failed") => {
  if (!ok) throw new Error(message);
};
const VID = "10000000-0000-0000-0000-000000000001", VIN = "1G1YY22G015000001";
const SOURCE = "20000000-0000-0000-0000-000000000001",
  EXTRACTOR = "30000000-0000-0000-0000-000000000001";
const OBS = "40000000-0000-0000-0000-000000000001";
const env = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"],
  saved = env.map((k) => Deno.env.get(k));
Deno.env.set(env[0], "https://db.test");
Deno.env.set(env[1], "test-key");
let handler: (req: Request) => Promise<Response>;
const serve = Deno.serve;
(Deno as any).serve = (fn: typeof handler) => {
  handler = fn;
};
await import("./index.ts");
Deno.serve = serve;
async function context() {
  const raw_json = JSON.stringify({
    VIN,
    ErrorCode: "0",
    BodyClass: "Coupe",
    VehicleType: "PASSENGER CAR",
    DisplacementL: "5.7",
  });
  const hash = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw_json)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  const decoded_at = "2026-10-01T12:00:00.123456Z",
    updated_at = "2026-10-01T12:00:01.654321Z";
  return {
    extractor_id: EXTRACTOR,
    revision: {
      id: "7",
      vehicle_id: VID,
      cache_vin: VIN,
      receipt: {
        method: "retained_vin_taxonomy_v1",
        reference_status: "accepted",
        input: {
          vin: VIN,
          cache_vin: VIN,
          raw_sha256: hash,
          source_recorded_at: decoded_at,
          cache_updated_at: updated_at,
        },
      },
    },
    vehicle: {
      id: VID,
      vin: VIN,
      is_public: true,
      deleted_at: null,
      status: "active",
      listing_kind: "vehicle",
    },
    cache: {
      vin: VIN,
      provider: "nhtsa",
      decoded_at,
      updated_at,
      body_type: "Coupe",
      vehicle_type: "PASSENGER CAR",
      raw_json,
    },
  };
}
async function run(body: unknown, scenario = "success", token = "test-key") {
  const c = await context(), derived = await qualifyRetainedVinReference(c);
  if (!derived.ok) throw new Error("invalid fixture");
  const row: any = {
    ...derived.input,
    id: OBS,
    source_id: SOURCE,
    extractor_id: EXTRACTOR,
    is_superseded: false,
    ingested_at: "2026-10-07T21:00:00.654321Z",
    content_hash: await observationContentHash(derived.input),
  };
  if (scenario === "private") c.vehicle.is_public = false;
  if (scenario === "changed") c.cache.updated_at = "2026-10-02T00:00:00Z";
  if (scenario === "missing_extractor") c.extractor_id = "";
  if (scenario === "corrupt") {
    row.structured_data.vin_reference_receipt.fields.DisplacementL = "9.9";
  }
  if (scenario === "wrong_parent") row.vehicle_id = SOURCE;
  if (scenario === "wrong_clock") {
    row.observed_at = "2026-10-01T12:00:00.123457Z";
  }
  if (scenario === "superseded") row.is_superseded = true;
  if (scenario === "later_revision") c.revision.id = "9";
  const calls: {
    path: string;
    method: string;
    body: any;
    writer: string | null;
  }[] = [];
  const originalFetch = globalThis.fetch;
  let reads = 0;
  let persisted = false;
  globalThis.fetch = async (request, options) => {
    const init = options as {
      method?: string;
      body?: unknown;
      headers?: HeadersInit;
    } | undefined;
    const url = new URL(
      typeof request === "string"
        ? request
        : request instanceof URL
        ? request.href
        : request.url,
    );
    const method = init?.method ?? "GET",
      payload = typeof init?.body === "string"
        ? JSON.parse(init.body)
        : undefined;
    const headers = new Headers(init?.headers);
    calls.push({
      path: url.pathname,
      method,
      body: payload,
      writer: headers.get("x-nuke-writer"),
    });
    const response = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    if (url.pathname.endsWith("read_retained_vin_reference_input")) {
      if (scenario === "batch_replay") c.revision.id = payload.p_revision_id;
      return scenario === "read_error"
        ? response({ message: "unavailable" }, 503)
        : response(c);
    }
    if (url.pathname.endsWith("observation_sources")) {
      return response([{
        id: SOURCE,
        base_trust_score: .85,
        supported_observations: ["specification"],
      }]);
    }
    if (url.pathname.endsWith("vehicle_observations")) {
      if (method === "POST") {
        if (scenario === "batch_replay") {
          persisted = true;
          Object.assign(row, payload);
        }
        return scenario === "race"
          ? response({ code: "23505", message: "duplicate" }, 409)
          : scenario === "guard_failure"
          ? response({ code: "23514", message: "custody" }, 400)
          : response({
            ...payload,
            id: OBS,
            is_superseded: false,
            ingested_at: row.ingested_at,
          }, 201);
      }
      reads++;
      return response(
        scenario === "batch_replay"
          ? (persisted ? [row] : [])
          : scenario === "success" || scenario === "guard_failure" ||
              (scenario === "race" && reads === 1)
          ? []
          : [row],
      );
    }
    throw new Error(`unexpected request ${url.pathname}`);
  };
  try {
    const response = await handler(
      new Request("https://handler.test", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }),
    );
    return { status: response.status, data: await response.json(), calls };
  } finally {
    globalThis.fetch = originalFetch;
  }
}
const selector = { mode: RETAINED_VIN_MODE, revision_id: "7", dry_run: false };
Deno.test("canonical60selector batch reuses real leaf custody and source dedup without nested edge calls", async () => {
  const r = await run({
    mode: RETAINED_VIN_BATCH_MODE,
    dry_run: false,
    revision_ids: Array.from({ length: 60 }, (_, i) => String(i + 7)),
  }, "batch_replay");
  assert(r.status === 200 && r.data.results.length === 60);
  assert(
    r.data.results.every((x: any) =>
      x.status_code === 200 && x.body.observation_id === OBS &&
      x.body.requested_taxonomy_revision_id === x.revision_id &&
      x.body.receipt.physical_configuration_verified === false
    ),
  );
  assert(
    r.data.results.reduce((n: number, x: any) => n + x.body.writes, 0) === 1,
  );
  assert(
    r.calls.filter((c) =>
      c.method === "POST" && c.path.endsWith("vehicle_observations")
    ).length === 1,
  );
  assert(r.calls.every((c) => c.path.startsWith("/rest/v1/")));
  assert(
    r.calls.filter((c) => c.path.endsWith("read_retained_vin_reference_input"))
      .length === 60,
  );
});
Deno.test("canonical VIN batch rejects anonymous and invalid selectors before any database request", async () => {
  const batch = {
    mode: RETAINED_VIN_BATCH_MODE,
    dry_run: false,
    revision_ids: ["7"],
  };
  const anonymous = await run(batch, "success", "invalid-token");
  assert(anonymous.status === 401 && anonymous.calls.length === 0);
  for (
    const input of [{ ...batch, dry_run: true }, {
      ...batch,
      revision_ids: ["7", "7"],
    }, {
      ...batch,
      revision_ids: Array.from({ length: 61 }, (_, i) => String(i + 7)),
    }, { ...batch, fields: { BodyClass: "Coupe" } }]
  ) {
    const r = await run(input);
    assert(r.status === 400 && r.calls.length === 0);
  }
});
Deno.test("canonical batch keeps signed-in users out and private parents explicitly refused", async () => {
  const batch = {
    mode: RETAINED_VIN_BATCH_MODE,
    dry_run: false,
    revision_ids: ["7"],
  };
  const secret = Deno.env.get("JWT_SIGNING_SECRET");
  Deno.env.set("JWT_SIGNING_SECRET", "test-secret");
  try {
    const encode = (value: unknown) =>
      btoa(JSON.stringify(value)).replace(/=/g, "").replace(/\+/g, "-").replace(
        /\//g,
        "_",
      );
    const base = `${encode({ alg: "HS256", typ: "JWT" })}.${
      encode({
        role: "authenticated",
        sub: VID,
        exp: Math.floor(Date.now() / 1000) + 60,
      })
    }`;
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode("test-secret"),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(base)),
    );
    const token = `${base}.${
      btoa(String.fromCharCode(...signature)).replace(/=/g, "").replace(
        /\+/g,
        "-",
      ).replace(/\//g, "_")
    }`;
    const user = await run(batch, "success", token);
    assert(user.status === 403 && user.calls.length === 0);
  } finally {
    secret === undefined
      ? Deno.env.delete("JWT_SIGNING_SECRET")
      : Deno.env.set("JWT_SIGNING_SECRET", secret);
  }
  const privateParent = await run(batch, "private");
  assert(
    privateParent.status === 200 &&
      privateParent.data.results[0].status_code === 422,
  );
  assert(
    privateParent.data.results[0].body.reason ===
      "parent_not_public_real_vehicle",
  );
  assert(
    !privateParent.calls.some((c) =>
      c.method === "POST" && c.path.endsWith("vehicle_observations")
    ),
  );
});
Deno.test("canonical VIN handler admits typed source and original clock with no downstream inference", async () => {
  const r = await run(selector);
  assert(
    r.status === 200 && r.data.writes === 1 && r.data.model_calls === 0,
    JSON.stringify({ status: r.status, data: r.data, calls: r.calls }),
  );
  const post = r.calls.find((c) =>
    c.path.endsWith("vehicle_observations") && c.method === "POST"
  )!;
  assert(
    post.body.source_vin === VIN &&
      post.body.source_vin_taxonomy_revision_id === "7" &&
      post.body.extractor_id === EXTRACTOR,
  );
  assert(
    post.body.observed_at === "2026-10-01T12:00:00.123456Z" &&
      post.body.agent_cost_cents === 0 && post.writer === "ingest-observation",
  );
  assert(
    r.data.receipt.physical_configuration_verified === false &&
      r.calls.length === 4,
  );
});
Deno.test("VIN preview derives source but does no observation read or write", async () => {
  const r = await run({ ...selector, dry_run: true });
  assert(r.status === 200 && r.data.writes === 0 && r.calls.length === 1);
});
Deno.test("VIN source mutations, private parents and missing registered route fail closed", async () => {
  for (
    const [scenario, status] of [["private", 422], ["changed", 422], [
      "missing_extractor",
      503,
    ], ["read_error", 503]] as const
  ) {
    const r = await run(selector, scenario);
    assert(r.status === status && r.data.writes === 0 && r.calls.length === 1);
  }
});
Deno.test("VIN selector rejects caller facts and missing write intent before DB access", async () => {
  for (
    const b of [{ ...selector, fields: {} }, {
      ...selector,
      dry_run: undefined,
    }, { ...selector, revision_id: 1.1 }]
  ) {
    const r = await run(b);
    assert(r.status === 400 && r.calls.length === 0);
  }
});
Deno.test("protected factory method and receipt cannot be caller-forged", async () => {
  for (
    const b of [{ extraction_method: RETAINED_VIN_METHOD }, {
      structured_data: { vin_reference_receipt: {} },
    }]
  ) {
    const r = await run(b);
    assert(r.status === 403 && r.calls.length === 0);
  }
  const r = await run(selector, "success", "invalid");
  assert(r.status === 401 && r.calls.length === 0);
});
Deno.test("VIN duplicate and insert race verify persisted source receipt", async () => {
  for (const scenario of ["duplicate", "race"]) {
    const r = await run(selector, scenario);
    assert(
      r.status === 200 && r.data.writes === 0 && r.data.duplicate === true &&
        r.data.observation_id === OBS,
    );
  }
});
Deno.test("processing-only revision accepts original supporting FK without new claim", async () => {
  const r = await run({ ...selector, revision_id: "9" }, "later_revision");
  assert(
    r.status === 200 && r.data.requested_taxonomy_revision_id === "9" &&
      r.data.supporting_taxonomy_revision_id === "7" && r.data.writes === 0,
  );
});
Deno.test("VIN replay cannot report success for corrupt, wrong-parent or wrong-microsecond evidence", async () => {
  for (const scenario of ["corrupt", "wrong_parent", "wrong_clock"]) {
    const r = await run(selector, scenario);
    assert(r.status === 503 && r.data.writes === 0);
  }
  const superseded = await run(selector, "superseded");
  assert(
    superseded.status === 422 &&
      superseded.data.reason === "retained_reference_superseded",
  );
  const failed = await run(selector, "guard_failure");
  assert(failed.status === 500 && failed.data.success !== true);
});
Deno.test("restore retained VIN test environment", () => {
  env.forEach((k, i) =>
    saved[i] === undefined ? Deno.env.delete(k) : Deno.env.set(k, saved[i]!)
  );
});
