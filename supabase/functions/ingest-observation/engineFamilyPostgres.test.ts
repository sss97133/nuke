/**
 * Opt-in integration contract: the real handler/SDK use a narrow test transport
 * into a disposable PostgreSQL fixture. Database acceptance, triggers, defaults
 * and readers are real. This is not deployed HTTP or PostgREST verification.
 * The fixture is installed by the owning schema contract before this test runs.
 */
import { observationClockMicroseconds } from "../_shared/observationContentHash.ts";
import { proposedDescriptionEngineFamilyLabelWitness } from "./retainedDescriptionPowertrain.ts";

const enabled = Deno.env.get("RUN_ENGINE_FAMILY_PG") === "1";
const VEHICLE = "22222222-2222-4222-8222-222222222222";
const SOURCE = "4cdc735c-f117-42f2-889f-ba33805639a5";
const PROPOSAL = "6b9de10b-1666-4bdf-bb69-7e82d62f8b32";
const REVIEWER = "00000000-0000-0000-0000-00000000a001";
const MODE = "retained_listing_engine_family_label_v1";
const IDENTITY_QUOTE = "This 1992 BMW 325i is described by its publisher with records.";
const SOURCE_QUOTE = "Powered by a 2.5-liter M50 inline-six paired with a five-speed manual transmission, the car is described by its publisher.";
const SOURCE_TEXT = `${IDENTITY_QUOTE} ${SOURCE_QUOTE} Factory and current configuration remain unverified.`;
const QUEUED_SOURCE_TEXT = `This vehicle is described by its publisher with records. ${SOURCE_QUOTE} Factory and current configuration remain unverified.`;
const DRAIN_MODE = "retained_listing_property_drain_v1";
const DISPLACEMENT = "66b2f1f6-b714-4ac0-85b6-60ba89529c1a";
const ORIGIN = "https://engine-family-fixture.test";
const SERVICE_KEY = "sb_secret_engine_family_local_fixture";
const PUBLISHABLE_KEY = "sb_publishable_engine_family_local_fixture";
const MIGRATION = new URL("../../migrations/20261011230939_retained_engine_family_intake.sql", import.meta.url);
const QUEUE_MIGRATION = new URL("../../migrations/20261015034500_retained_engine_family_queue.sql", import.meta.url);
type Row = Record<string, any>;
type ServiceHeader = "authorization" | "apikey";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function equal(actual: unknown, expected: unknown, message: string) {
  const stable = (value: any): any => Array.isArray(value) ? value.map(stable)
    : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])) : value;
  const serialize = (value: unknown) => JSON.stringify(stable(value), (_key, item) =>
    typeof item === "bigint" ? { $bigint: item.toString() } : item);
  assert(serialize(actual) === serialize(expected), `${message}: ${serialize(actual)} != ${serialize(expected)}`);
}
function quote(value: string): string {
  assert(!value.includes("\0"), "NUL is not a SQL literal");
  return `'${value.replaceAll("'", "''")}'`;
}

const columns = {
  vehicles: ["id", "is_public", "deleted_at", "listing_kind"],
  observation_sources: ["id", "slug", "base_trust_score", "supported_observations"],
  observation_properties: ["id", "property_key", "label", "applies_to_kinds", "namespace", "deprecated_at", "data_type",
    "unit", "parent_property_id", "discriminator_key", "cardinality", "verification_scope", "ratified_at", "proposed_by_proposal_id"],
  schema_proposals: ["id", "status", "promoted_to_id"],
  vehicle_observations: [
    "id", "vehicle_id", "kind", "is_superseded", "property_id", "subject_type", "subject_id", "source_id",
    "source_url", "source_identifier", "observed_at", "ingested_at", "extraction_method", "confidence_score",
    "structured_data", "extraction_metadata", "content_text", "content_hash", "source_observation_id",
    "vehicle_match_confidence", "vehicle_match_signals", "confidence", "confidence_factors", "observer_raw",
    "extractor_id", "agent_tier", "agent_model", "agent_cost_cents", "agent_duration_ms", "raw_source_ref",
    "citation_document_id", "citation_secure_document_id", "citation_page_number", "citation_excerpt",
  ],
} as const;
type Table = keyof typeof columns;

Deno.test({
  name: "engine family: real handler crosses reviewed registry, PostgreSQL guard and canonical readers",
  ignore: !enabled,
  async fn(t) {
    let parentId = "";
    const host = Deno.env.get("PGHOST") ?? "";
    const port = Deno.env.get("PGPORT") ?? "";
    const database = Deno.env.get("PGDATABASE") ?? "";
    const user = Deno.env.get("PGUSER") ?? "";
    const psql = Deno.env.get("PSQL_BIN") ?? "";
    assert(/^(?:localhost|127\.0\.0\.1|::1)$/.test(host) || /^\/(?:private\/)?tmp\/[A-Za-z0-9_./-]+$/.test(host), "Only an explicit local fixture host is allowed");
    assert(!host.includes(".."), "Parent-directory socket traversal is forbidden");
    assert(/^\d{1,5}$/.test(port) && Number(port) > 0 && Number(port) <= 65535, "Explicit local PGPORT required");
    assert(/^dm_refinement_[A-Za-z0-9_]+$/.test(database), "Disposable dm_refinement_* database required");
    assert(/^[A-Za-z_][A-Za-z0-9_-]*$/.test(user), "Explicit PGUSER required");
    assert(/^\/.*\/psql$/.test(psql), "PSQL_BIN must name the installed psql binary by absolute path");

    let trustedFixture = false;
    async function command(extraArgs: string[]) {
      return await new Deno.Command(psql, {
        args: ["-X", "-A", "-t", "-q", "--host", host, "--port", port, "--username", user, "--dbname", database,
          "--set", "ON_ERROR_STOP=1", "--set", "VERBOSITY=verbose", ...extraArgs],
        env: { PGCONNECT_TIMEOUT: "3", PGOPTIONS: "-c statement_timeout=10000 -c lock_timeout=1000 -c standard_conforming_strings=on -c timezone=UTC" },
        stdout: "piped", stderr: "piped",
      }).output();
    }
    const decoder = new TextDecoder();
    const preflight = await command(["--command", "SELECT jsonb_build_object('database',current_database(),'address',host(inet_server_addr()),'recovery',pg_is_in_recovery())::text"]);
    assert(preflight.success, `Local fixture identity unavailable: ${decoder.decode(preflight.stderr)}`);
    const identity = JSON.parse(decoder.decode(preflight.stdout));
    equal(identity.database, database, "Connected database must equal the explicit disposable name");
    // This one CI job connects to its service container via a localhost port mapping.
    const ciContainer = Deno.env.get("GITHUB_ACTIONS") === "true" && Deno.env.get("GITHUB_JOB") === "engine-family-intake" &&
      host === "localhost" && database === "dm_refinement_engine_family_ci" &&
      /^(?:10\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.)/.test(identity.address ?? "");
    assert(identity.address === null || ["127.0.0.1", "::1"].includes(identity.address) || ciContainer, "Server must be local");
    assert(identity.recovery === false, "Fixture must not be a replica");
    trustedFixture = true;

    async function sql(statement: string, role?: "service_role" | "anon") {
      assert(trustedFixture, "Validate the local database before any fixture write");
      const roleSetup = role ? `SET LOCAL ROLE ${role}; SET LOCAL "request.jwt.claims" = ${quote(JSON.stringify({ role }))}; SET LOCAL "request.jwt.claim.role" = ${quote(role)};` : "";
      const result = await command(["--command", `BEGIN; ${roleSetup} ${statement}; COMMIT;`]);
      const stderr = decoder.decode(result.stderr);
      if (!result.success) throw Object.assign(new Error(stderr), { code: stderr.match(/ERROR:\s+([0-9A-Z]{5}):/)?.[1] ?? "PG_ERROR" });
      return decoder.decode(result.stdout).trim();
    }
    async function json(statement: string, role?: "service_role" | "anon"): Promise<any> {
      return JSON.parse(await sql(statement, role));
    }
    const bridgeErrors: string[] = [];
    const databaseErrors: { code: string; message: string }[] = [];
    let inserts = 0;
    let nativeIdentityInserts = 0;
    let parentInserts = 0;
    const knownParents = new Set<string>();
    const drainCalls: { name: string; args: Row }[] = [];
    const drainWorkers = new Set<string>();
    const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
      status, headers: { "Content-Type": "application/json" },
    });
    const bridge: typeof fetch = async (resource, options) => {
      try {
        const request = new Request(resource, options);
        const url = new URL(request.url);
        assert(url.origin === ORIGIN, `Unexpected SDK origin: ${url.origin}`);
        assert(request.headers.get("authorization") === `Bearer ${SERVICE_KEY}`, "Unexpected SDK authorization");
        assert(request.headers.get("apikey") === SERVICE_KEY, "SDK must use the fixture's named project secret");
        const queueRpc = url.pathname.match(/^\/rest\/v1\/rpc\/(claim_retained_listing_properties|finish_retained_listing_property)$/);
        if (queueRpc) {
          assert(request.method === "POST" && url.search === "", "Queue RPC requires its exact POST route");
          const name = queueRpc[1], args = await request.json();
          assert(/^retained-listing:[0-9a-f-]{36}$/.test(args.p_worker), "Queue worker must be created by the actual drain");
          let statement: string;
          if (name === "claim_retained_listing_properties") {
            equal(Object.keys(args).sort(), ["p_limit", "p_worker"], "Bounded claim argument names");
            assert(Number.isInteger(args.p_limit) && args.p_limit >= 1 && args.p_limit <= 120, "Claim limit remains bounded");
            drainWorkers.add(args.p_worker);
            statement = `SELECT COALESCE(jsonb_agg(to_jsonb(c)),'[]'::jsonb)::text FROM public.claim_retained_listing_properties(${quote(args.p_worker)},${args.p_limit}) c`;
          } else {
            equal(Object.keys(args).sort(), ["p_property", "p_result", "p_source", "p_status", "p_worker"], "Completion argument names");
            assert(drainWorkers.has(args.p_worker) && knownParents.has(args.p_source), "Completion must belong to this drain's synthetic work");
            assert(/^[0-9a-f-]{36}$/.test(args.p_property) && ["done", "refused", "retry", "deferred"].includes(args.p_status), "Exact queue property and completion state required");
            assert(args.p_result === null || /^[0-9a-f-]{36}$/.test(args.p_result), "Completion result must be an exact UUID or null");
            statement = `SELECT to_jsonb(public.finish_retained_listing_property(${quote(args.p_source)}::uuid,${quote(args.p_property)}::uuid,${quote(args.p_worker)},${quote(args.p_status)},${args.p_result === null ? "NULL" : `${quote(args.p_result)}::uuid`}))::text`;
          }
          drainCalls.push({ name, args });
          try {
            const result = await json(statement, "service_role");
            if (name === "claim_retained_listing_properties") {
              assert(Array.isArray(result) && result.length <= args.p_limit && result.every(row => knownParents.has(row.source_observation_id)), "Claims stay within the synthetic source frame");
            } else assert(typeof result === "boolean", "Completion returns actual PostgreSQL custody proof");
            return respond(result);
          } catch (error) {
            const failure = error as Error & { code: string };
            databaseErrors.push({ code: failure.code, message: failure.message });
            return respond({ code: failure.code, message: failure.message }, 400);
          }
        }
        if (url.pathname === "/rest/v1/rpc/retained_listing_property_result_matches") {
          assert(request.method === "POST" && url.search === "", "Only the exact result-match RPC POST is supported");
          const args = await request.json();
          equal(Object.keys(args).sort(), ["p_property", "p_result", "p_source"], "Result-match RPC argument names");
          assert(knownParents.has(args.p_source), "Result-match RPC must use a handler-created synthetic parent");
          const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          assert(uuid.test(args.p_property) && uuid.test(args.p_result), "Result-match RPC requires exact UUIDs");
          try {
            const result = await json(`SELECT to_jsonb(public.retained_listing_property_result_matches(${quote(args.p_source)}::uuid,${quote(args.p_property)}::uuid,${quote(args.p_result)}::uuid))::text`, "service_role");
            assert(typeof result === "boolean", "PostgreSQL must return a result-match boolean");
            return respond(result);
          } catch (error) {
            const failure = error as Error & { code: string };
            databaseErrors.push({ code: failure.code, message: failure.message });
            return respond({ code: failure.code, message: failure.message }, 400);
          }
        }
        const match = url.pathname.match(/^\/rest\/v1\/(vehicles|observation_sources|observation_properties|vehicle_observations|schema_proposals)$/);
        assert(match, `Unhandled SDK route: ${url.pathname}`);
        const table = match[1] as Table;
        const allowed = columns[table] as readonly string[];
        const selection = url.searchParams.get("select") ?? "*";
        const selected = selection === "*" ? ["*"] : selection.split(",").map((s) => s.trim());
        assert(selected.every((name) => name === "*" || allowed.includes(name)), `Unhandled selected columns: ${selection}`);
        assert(!selected.includes("*") || selected.length === 1, "Mixed wildcard projections are not supported");
        const filters: string[] = [];
        let limit = 20;
        for (const [key, value] of url.searchParams) {
          if (key === "select") continue;
          if (key === "limit") {
            assert(/^\d+$/.test(value) && Number(value) <= 20, "Fixture reads must remain bounded");
            limit = Number(value);
            continue;
          }
          assert(allowed.includes(key), `Unhandled filter column: ${key}`);
          if (value.startsWith("eq.")) filters.push(`${key} = ${quote(value.slice(3))}`);
          else if (/^is\.(null|true|false)$/.test(value)) filters.push(`${key} IS ${value.slice(3).toUpperCase()}`);
          else throw new Error(`Unhandled filter: ${key}=${value}`);
        }
        let statement: string;
        let parentInsert = false;
        if (request.method === "GET") {
          assert(filters.length > 0, "Unfiltered SDK table scans are forbidden");
          statement = `SELECT COALESCE(jsonb_agg(to_jsonb(r)),'[]'::jsonb)::text FROM (SELECT ${selected.join(",")} FROM public.${table} WHERE ${filters.join(" AND ")} LIMIT ${limit}) r`;
        } else {
          assert(request.method === "POST" && table === "vehicle_observations", `Unhandled SDK mutation: ${request.method} ${table}`);
          assert(filters.length === 0 && [...url.searchParams.keys()].every((key) => key === "select"), "Insert filters are forbidden");
          const body = await request.json();
          assert(body && typeof body === "object" && !Array.isArray(body), "Only one observation object may be inserted");
          const names = Object.keys(body);
          assert(names.length > 0 && names.every((name) => allowed.includes(name)), "Unknown observation insert column");
          assert(!names.some((name) => ["id", "ingested_at", "is_superseded"].includes(name)), "DB identity and defaults must remain authoritative");
          assert(body.vehicle_id === VEHICLE && body.source_id === SOURCE, "Only this synthetic source/vehicle may be written");
          if (body.source_observation_id === undefined) {
            const identifiers = ["engine-family-native-fixture:v1", "engine-family-queued-fixture:v1", "engine-family-withheld-fixture:v1"];
            assert(parentInserts < identifiers.length && body.property_id === undefined &&
              body.kind === "listing" && body.extraction_method === "html_description_capture" &&
              body.content_text === (parentInserts === 0 ? SOURCE_TEXT : QUEUED_SOURCE_TEXT) &&
              body.source_identifier === identifiers[parentInserts],
              "Only the three exact native parents may be seeded through sanctioned intake");
            parentInsert = true;
            parentInserts++;
          } else {
            assert(knownParents.has(body.source_observation_id), "Child must reference a handler-created native parent");
            if (body.structured_data?.property_key === "engine_family_label") inserts++;
            else {
              assert(["make", "model"].includes(body.structured_data?.property_key), "Only native identity siblings are allowed");
              nativeIdentityInserts++;
            }
          }
          statement = `WITH inserted AS (INSERT INTO public.vehicle_observations (${names.join(",")}) SELECT ${names.join(",")} FROM jsonb_populate_record(NULL::public.vehicle_observations,${quote(JSON.stringify(body))}::jsonb) RETURNING ${selected.join(",")}) SELECT COALESCE(jsonb_agg(to_jsonb(r)),'[]'::jsonb)::text FROM inserted r`;
        }
        let rows: Row[];
        try {
          rows = await json(statement, "service_role");
        } catch (error) {
          const failure = error as Error & { code: string };
          databaseErrors.push({ code: failure.code, message: failure.message });
          return respond({ code: failure.code, message: failure.message }, failure.code === "23505" ? 409 : 400);
        }
        if (parentInsert) {
          assert(rows.length === 1 && /^[0-9a-f-]{36}$/.test(rows[0].id), "Native source must receive its PostgreSQL identity");
          knownParents.add(rows[0].id);
        }
        if (request.headers.get("accept")?.includes("application/vnd.pgrst.object+json")) {
          assert(rows.length <= 1, "Singular SDK result unexpectedly contains multiple rows");
          return respond(rows[0] ?? null, request.method === "POST" ? 201 : 200);
        }
        return respond(rows, request.method === "POST" ? 201 : 200);
      } catch (error) {
        bridgeErrors.push(String(error));
        throw error;
      }
    };

    const saved = new Map(["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEYS",
      "SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_JWKS"].map((name) => [name, Deno.env.get(name)]));
    const originalFetch = globalThis.fetch;
    const originalServe = Deno.serve;
    let handler: ((request: Request) => Promise<Response>) | undefined;
    let parent: Row;
    let parentBefore: string;
    const countChildren = () => json(`SELECT count(*)::text FROM public.vehicle_observations WHERE source_observation_id=${quote(parentId)}::uuid AND structured_data->>'property_key'='engine_family_label'`);
    const readers = (key = "engine_family_label") => json(`SELECT jsonb_build_object(
      'provenance',public.get_field_provenance(${quote(VEHICLE)}::uuid,${quote(key)}),
      'canonical',(SELECT COALESCE(jsonb_agg(to_jsonb(c)),'[]'::jsonb) FROM public.vehicle_canonical c
        JOIN public.observation_properties op ON op.id=c.property_id
        WHERE c.vehicle_id=${quote(VEHICLE)}::uuid AND op.property_key=${quote(key)}),
      'bulk',(SELECT COALESCE(jsonb_agg(s),'[]'::jsonb) FROM public.get_vehicle_specs(ARRAY[${quote(VEHICLE)}::uuid],true) s))::text`, "anon");
    const bulkFamilyClaims = (state: Row) => (state.bulk[0]?.typed_claims ?? []).filter((claim: Row) => claim.property_key === "engine_family_label");
    const assertBulkFamily = (state: Row, observationId: string, source: Row) => {
      equal(state.bulk.length, 1, "Anonymous bulk specifications return the eligible synthetic vehicle");
      equal(state.bulk[0].typed_claims_status, "current_core_scope_read", "Bulk typed testimony is explicitly requested");
      equal(state.bulk[0].model_scope.record_binding_property_keys, 11, "Family vocabulary does not invent a retained vehicle-record binding");
      equal(state.bulk[0].model_scope.canonical_property_keys, 12, "The bulk canonical scope includes the separately ratified family meaning");
      const claims = bulkFamilyClaims(state);
      equal(claims.length, 1, "Bulk specifications expose the one current family claim");
      const claim = claims[0];
      for (const [key, expected] of Object.entries({ observation_id: observationId, source_observation_id: source.id,
        source_url: source.source_url, value: "M50", data_type: "string", unit: null,
      })) equal(claim[key], expected, `Bulk family ${key}`);
      for (const [key, expected] of Object.entries({ source_value: SOURCE_QUOTE,
        label_role: "publisher_powering_engine_label", engine_identity_status: "unverified",
        source_capture_sha256: source.structured_data.source_capture_sha256,
        source_captured_at: source.structured_data.source_captured_at, source_capture_basis: "protected_snapshot",
        source_witness_version: "retained_description_engine_family_label_v1", source_event_time_status: "unknown",
        factory_configuration_status: "unknown", current_configuration_status: "unknown", independent_source: false,
      })) equal(claim.qualifiers[key], expected, `Bulk family qualifier ${key}`);
      equal(observationClockMicroseconds(claim.observed_at), observationClockMicroseconds(source.ingested_at), "Bulk family observation clock preserves source microseconds");
    };
    const modifiedFunctions = [
      "public.retained_description_powertrain_witness(text,text)",
      "public.retained_description_property_value_matches(public.vehicle_observations,public.vehicle_observations)",
      "public.validate_retained_listing_property_source()",
      "public.get_field_provenance(uuid,text)",
    ].map((signature) => `to_regprocedure(${quote(signature)})`).join(",");
    const functionMetadata = () => json(`SELECT jsonb_agg(jsonb_build_object(
      'signature',p.oid::regprocedure::text,'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,
      'security_definer',p.prosecdef,'config',p.proconfig,'volatility',p.provolatile,
      'parallel',p.proparallel,'strict',p.proisstrict,'leakproof',p.proleakproof)
      ORDER BY p.oid::regprocedure::text)::text FROM pg_proc p WHERE p.oid=ANY(ARRAY[${modifiedFunctions}]::oid[])`);
    const functionDefinitions = () => json(`SELECT jsonb_agg(pg_get_functiondef(p.oid) ORDER BY p.oid::regprocedure::text)::text
      FROM pg_proc p WHERE p.oid=ANY(ARRAY[${modifiedFunctions}]::oid[])`);
    let metadataBefore: unknown;
    let childId: string;
    const request = (extra: Row = {}, token = SERVICE_KEY, header: ServiceHeader = "authorization") => new Request(`${ORIGIN}/functions/v1/ingest-observation`, {
      method: "POST", headers: { "Content-Type": "application/json", [header]: header === "authorization" ? `Bearer ${token}` : token },
      body: JSON.stringify({ mode: MODE, source_observation_id: parentId, ...extra }),
    });
    try {
      Deno.env.set("SUPABASE_URL", ORIGIN);
      // Exercise the current named-key path and never inherit a developer's project credentials.
      Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
      Deno.env.set("SUPABASE_SECRET_KEYS", JSON.stringify({ functions: SERVICE_KEY }));
      Deno.env.set("SUPABASE_ANON_KEY", PUBLISHABLE_KEY);
      Deno.env.set("SUPABASE_PUBLISHABLE_KEYS", JSON.stringify({ default: PUBLISHABLE_KEY }));
      const signer = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
      Deno.env.set("SUPABASE_JWKS", JSON.stringify({ keys: [{
        ...(await crypto.subtle.exportKey("jwk", signer.publicKey)), kid: "engine-family-fixture", alg: "ES256",
      }] }));
      const base64url = (value: string) => btoa(value).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
      const claims = { role: "authenticated", sub: REVIEWER, exp: Math.floor(Date.now() / 1000) + 3600 };
      const signingInput = `${base64url(JSON.stringify({ alg: "ES256", typ: "JWT", kid: "engine-family-fixture" }))}.${base64url(JSON.stringify(claims))}`;
      const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signer.privateKey, new TextEncoder().encode(signingInput));
      const userToken = `${signingInput}.${base64url(String.fromCharCode(...new Uint8Array(signature)))}`;
      const legacyToken = `${base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${base64url(JSON.stringify({ ...claims, role: "service_role" }))}.Zml4dHVyZQ`;
      globalThis.fetch = bridge;
      (Deno as any).serve = (registered: (request: Request) => Promise<Response>) => { handler = registered; };
      await import("./index.ts");
      Deno.serve = originalServe;
      assert(handler, "Real ingest handler was not registered");
      const seed = await handler(new Request(`${ORIGIN}/functions/v1/ingest-observation`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
        body: JSON.stringify({
          source_slug: "bat", kind: "listing", vehicle_id: VEHICLE,
          source_url: "https://bringatrailer.com/listing/engine-family-fixture/", source_identifier: "engine-family-native-fixture:v1",
          observed_at: "2026-10-11T08:00:00.123456Z", extraction_method: "html_description_capture",
          content_text: SOURCE_TEXT,
          defer_analysis: true, agent_cost_cents: 0,
          structured_data: {
            extractor: "extract-bat-core", source_text_field: "extract-bat-core.extractDescription", description_capture: true,
            extractor_input_truncated: false, source_capture_basis: "protected_snapshot", source_capture_sha256: "a".repeat(64),
            source_captured_at: "2026-10-11T08:00:00.123456Z", observation_time_basis: "source_capture", source_event_time_status: "unknown",
          },
        }),
      }));
      const seeded = await seed.json();
      equal(bridgeErrors, [], "Native source seeding uses only sanctioned SDK routes");
      equal(seed.status, 200, `Native source seeding failed: ${JSON.stringify(seeded)}`);
      assert(seeded.success === true && seeded.duplicate === false, "Fixture source must be created by the real intake handler");
      parentId = seeded.observation_id;
      assert(typeof parentId === "string" && /^[0-9a-f-]{36}$/.test(parentId), "PostgreSQL must return the parent identity");
      parent = await json(`SELECT to_jsonb(o)::text FROM public.vehicle_observations o WHERE id=${quote(parentId)}::uuid`);
      parentBefore = JSON.stringify(parent);
      const invoke = async (extra: Row = {}, token = SERVICE_KEY, header: ServiceHeader = "authorization") => {
        const response = await handler!(request(extra, token, header));
        equal(bridgeErrors, [], "Every SDK request must use the explicitly supported transport");
        return { status: response.status, body: await response.json() };
      };
      let makeId: string;
      const nativeIdentity = async (key: "make" | "model", value: string, duplicate: boolean, expectedId?: string) => {
        const response = await invoke({ mode: `retained_listing_${key}_v1` });
        equal(response.status, 200, `Native ${key} intake failed: ${JSON.stringify(response.body)}`);
        equal(response.body.duplicate, duplicate, `Native ${key} replay status`);
        if (expectedId) equal(response.body.observation_id, expectedId, `Native ${key} replay keeps its identity`);
        const state = await readers(key);
        equal(state.provenance?.observations?.length, 1, `Native ${key} remains public through provenance`);
        equal(state.canonical.length, 1, `Native ${key} remains public through canonical state`);
        const witness = state.provenance.observations[0];
        equal(witness.id, response.body.observation_id, `Native ${key} provenance points to its admitted observation`);
        equal(witness.value, value, `Native ${key} preserves the publisher label`);
        equal(witness.source_value, IDENTITY_QUOTE, `Native ${key} preserves the publisher introduction`);
        equal(witness.source_witness_version, "retained_description_identity_labels_v1", `Native ${key} keeps its identity witness`);
        const canonical = state.canonical[0];
        equal(canonical.observation_id, response.body.observation_id, `Native ${key} canonical identity`);
        equal(canonical.structured_data[key], value, `Native ${key} canonical label`);
        equal(canonical.structured_data.identity_resolution_status, "unverified", `Native ${key} does not establish physical identity`);
        equal(canonical.structured_data.source_subject_label, "BMW 325i", `Native ${key} preserves the full source subject`);
        return response.body.observation_id as string;
      };

      assert(await t.step("native make already crosses the current handler, database and public readers", async () => {
        makeId = await nativeIdentity("make", "BMW", false);
        equal(await countChildren(), 0, "Native identity admission does not create family testimony");
      }), "Current native identity contract failed before the family migration");

      assert(await t.step("unapproved vocabulary cannot enter the actual handler", async () => {
        const proposal = await json(`SELECT jsonb_build_object('status',status,'promoted_to_id',promoted_to_id) FROM public.schema_proposals WHERE id=${quote(PROPOSAL)}::uuid`);
        equal(proposal, { status: "open", promoted_to_id: null }, "Fixture retains the unresolved proposal");
        const response = await invoke();
        equal(response.status, 400, "Absent registry property must be refused");
        assert(response.body.error.includes("Unknown, pending or deprecated"), "Refusal must identify the registry boundary");
        equal(inserts, 0, "No insertion attempted before registration");
        equal(await countChildren(), 0, "No child before review");
        const queueRefusal = await command(["--file", decodeURIComponent(QUEUE_MIGRATION.pathname)]);
        assert(!queueRefusal.success && decoder.decode(queueRefusal.stderr).includes("requires curator ratification"),
          "Queue migration must refuse the still-open proposal before modifying its owners");
        equal(await json("SELECT to_jsonb(EXISTS(SELECT FROM pg_attribute WHERE attrelid='public.retained_listing_property_replay'::regclass AND attname='engine_family_highwater' AND NOT attisdropped))::text"), false,
          "Rejected installation cannot add family replay state");
      }), "Unapproved-vocabulary contract failed");

      assert(await t.step("real review registers vocabulary but the old database guard still refuses the same request", async () => {
        await sql(`INSERT INTO public.schema_proposal_reviews(proposal_id,reviewer_user_id,decision,reasoning) VALUES (${quote(PROPOSAL)}::uuid,${quote(REVIEWER)}::uuid,'approve','Synthetic local approval for the source-to-consumer regression contract')`);
        const registration = await json(`SELECT jsonb_build_object('status',p.status,'namespace',op.namespace,'key',op.property_key) FROM public.schema_proposals p JOIN public.observation_properties op ON op.id=p.promoted_to_id WHERE p.id=${quote(PROPOSAL)}::uuid`);
        equal(registration, { key: "engine_family_label", status: "approved", namespace: "core" }, "Existing review/apply machinery must register the proposed definition");
        const response = await invoke();
        equal(response.status, 500, "Old database admission must still refuse this registered property");
        assert(databaseErrors.some((failure) => failure.code === "23514" && failure.message.includes("unsupported retained property")), "Must reproduce the actual retained-property guard failure");
        equal(await countChildren(), 0, "Failed intake must leave no observation behind");
      }), "Pre-repair failure was not demonstrated");

      assert(await t.step("migration connects the unchanged selector to PostgreSQL and retry preserves its identity", async () => {
        assert(trustedFixture, "Local fixture must remain validated before migration");
        metadataBefore = await functionMetadata();
        assert(Array.isArray(metadataBefore) && metadataBefore.length === 4, "Every replaced function must exist in the captured fixture");
        const installed = await command(["--file", decodeURIComponent(MIGRATION.pathname)]);
        assert(installed.success, `Local migration failed: ${decoder.decode(installed.stderr)}`);
        equal(await functionMetadata(), metadataBefore, "Migration preserves function ownership, ACLs and security/runtime attributes");
        const response = await invoke();
        equal(response.status, 200, `Repaired intake failed: ${JSON.stringify(response.body)}`);
        assert(response.body.success === true && response.body.duplicate === false, "First repaired request must create the observation");
        childId = response.body.observation_id;
        const retry = await invoke();
        equal(retry.status, 200, "Identical selector must replay");
        assert(retry.body.duplicate === true, "Identical selector must deduplicate");
        equal(retry.body.observation_id, response.body.observation_id, "Replay must preserve observation identity");
        equal(await countChildren(), 1, "Exactly one source-derived observation exists");
        const child = await json(`SELECT to_jsonb(o)::text FROM public.vehicle_observations o WHERE id=${quote(response.body.observation_id)}::uuid`);
        equal(child.source_observation_id, parentId, "Typed source reference survives the handler insert");
        equal(child.structured_data.engine_family_label, "M50", "Literal family value survives typed admission");
        equal(child.structured_data.source_value, SOURCE_QUOTE, "The complete original quote survives typed admission");
        equal(child.structured_data.source_capture_sha256, parent.structured_data.source_capture_sha256, "Capture digest is preserved");
        equal(child.structured_data.source_captured_at, parent.structured_data.source_captured_at, "Capture clock string is preserved exactly");
        equal(child.structured_data.source_observed_at, parent.observed_at, "Parent observed clock is preserved exactly");
        equal(child.structured_data.source_recorded_at, parent.ingested_at, "Parent ingest clock is preserved exactly");
        equal(observationClockMicroseconds(child.observed_at), observationClockMicroseconds(parent.ingested_at), "Derived clock retains microseconds");
        equal(child.structured_data.source_event_time_status, "unknown", "Capture time never establishes event time");
        equal(child.structured_data.engine_identity_status, "unverified", "Publisher label never establishes physical engine identity");
        equal(child.agent_model, null, "No model is called");
        equal(child.agent_cost_cents, 0, "No model spend is attributed");
        assert(child.confidence_score <= .6, "Derived testimony retains its confidence cap");
        const unchanged = await json(`SELECT to_jsonb(o)::text FROM public.vehicle_observations o WHERE id=${quote(parentId)}::uuid`);
        equal(JSON.stringify(unchanged), parentBefore, "The original testimony remains byte-equivalent as JSON");
      }), "Repaired intake contract failed");

      assert(await t.step("family expansion preserves native make replay and admits native model through PostgreSQL", async () => {
        await nativeIdentity("make", "BMW", true, makeId);
        await nativeIdentity("model", "325i", false);
        equal(nativeIdentityInserts, 2, "Each native identity sibling is inserted once across the migration");
        equal(await countChildren(), 1, "Native identity retains the same single family result");
      }), "Family expansion regressed the existing native identity contract");

      assert(await t.step("SQL and TypeScript witnesses agree on 20 bounded positive and adversarial cases", async () => {
        const cases: [string, string | null][] = [
          [SOURCE_QUOTE, "M50"],
          ["The car is powered by a 5.7-liter LS1 V8 paired with a manual transmission.", "LS1"],
          ["The truck is powered by a 4.7-liter 2UZ-FE V8 linked to an automatic transmission.", "2UZ-FE"],
          ["Power comes from a 2.6-liter RB26DETT inline-six.", "RB26DETT"],
          ["The car was powered by a 2.0-liter N20 inline-four.", "N20"],
          ["Power is supplied by a 2.0-liter N20 inline-four.", "N20"],
          ["The car is powered by a turbocharged 2.0-liter N20 inline-four.", "N20"],
          ["The car is powered by a supercharged 2.0-liter N20 inline-four.", "N20"],
          ["The car is powered by twin-turbocharged 2.0-liter N20 inline-four.", "N20"],
          ["The car is powered by a 2.0-liter N20 inline-four. Power comes from a 2.0-liter N20 inline-four.", "N20"],
          ["The car is powered by a 2.0-liter N20 inline-four. Power comes from a 2.0-liter B48 inline-four.", null],
          ["The car is powered by a 2.0-liter N20 inline-four. Power comes from a 3.0-liter N20 inline-six.", null],
          ["The car is powered by a 2.0-liter N20 inline-four?", null],
          ["This model is powered by a 2.0-liter N20 inline-four.", null],
          ["This brochure describes a car powered by a 2.0-liter N20 inline-four.", null],
          ["The car is powered by electricity and includes a brochure describing a 2.0-liter N20 inline-four.", null],
          ["The car is powered by a possible 2.0-liter N20 inline-four.", null],
          ["The car would be powered by a 2.0-liter N20 inline-four.", null],
          ["The car is powered by a 2.0-liter 16V inline-four.", null],
          ["The engine stamp pad is blank, and a casting number is shown in the gallery.", null],
        ];
        const texts = cases.map(([sentence]) => `This vehicle is described by its publisher with records. ${sentence} Factory and current configuration remain unverified.`);
        const witnesses = await json(`SELECT jsonb_agg(jsonb_build_object('index',ordinality,'witness',
          public.retained_description_powertrain_witness('engine_family_label',body)) ORDER BY ordinality)::text
          FROM jsonb_array_elements_text(${quote(JSON.stringify(texts))}::jsonb) WITH ORDINALITY AS c(body,ordinality)`);
        equal(witnesses.length, cases.length, "Each bounded case gets an actual PostgreSQL witness result");
        for (const [i, text] of texts.entries()) {
          const witness = proposedDescriptionEngineFamilyLabelWitness(text);
          equal(witness?.value ?? null, cases[i][1], `Literal acceptance expectation for case ${i + 1}`);
          equal(witnesses[i].index, i + 1, "SQL witness ordering");
          equal(witnesses[i].witness, witness, `Full source-quote/value parity for case ${i + 1}`);
        }
      }), "The two implementations disagree about admitted testimony");

      assert(await t.step("public provenance and canonical readers expose the original witness with its limits", async () => {
        const state = await readers();
        equal(state.provenance?.observations?.length, 1, "The public provenance reader must expose one eligible observation");
        const witness = state.provenance.observations[0];
        for (const [key, expected] of Object.entries({
          id: childId, value: "M50", source_value: SOURCE_QUOTE, source_observation_id: parentId,
          source_capture_sha256: parent.structured_data.source_capture_sha256,
          source_captured_at: parent.structured_data.source_captured_at, source_capture_basis: "protected_snapshot",
          source_observed_at: parent.observed_at, source_recorded_at: parent.ingested_at,
          source_field: "content_text", source_extraction_method: "html_description_capture",
          normalization_version: "retained_engine_family_label_v1", source_witness_version: "retained_description_engine_family_label_v1",
          source_event_time_status: "unknown", factory_configuration_status: "unknown", current_configuration_status: "unknown",
          label_role: "publisher_powering_engine_label", engine_identity_status: "unverified",
          claim_role: "listing_claim", independent_source: false, source_url: parent.source_url,
        })) equal(witness[key], expected, `Public provenance ${key}`);
        equal(observationClockMicroseconds(witness.observed_at), observationClockMicroseconds(parent.ingested_at), "Public provenance keeps the microsecond observation clock");
        equal(state.canonical.length, 1, "The canonical reader must expose the same property");
        const canonical = state.canonical[0];
        equal(canonical.observation_id, childId, "Canonical state points to the same source-derived observation");
        equal(canonical.structured_data.engine_family_label, "M50", "Canonical value is the literal publisher label");
        equal(canonical.structured_data.source_value, SOURCE_QUOTE, "Canonical state retains the full quote");
        equal(canonical.structured_data.source_capture_sha256, parent.structured_data.source_capture_sha256, "Canonical state retains the capture hash");
        equal(canonical.structured_data.source_captured_at, parent.structured_data.source_captured_at, "Canonical state retains the exact capture clock");
        equal(canonical.structured_data.source_observed_at, parent.observed_at, "Canonical state retains the source observation clock");
        equal(canonical.structured_data.source_recorded_at, parent.ingested_at, "Canonical state retains the source ingest clock");
        equal(canonical.structured_data.engine_identity_status, "unverified", "Canonical state does not certify engine identity");
        equal(canonical.structured_data.label_role, "publisher_powering_engine_label", "Canonical state preserves the label's scope");
        equal(canonical.structured_data.source_event_time_status, "unknown", "Canonical state does not infer event time");
        equal(bulkFamilyClaims(state), [], "The existing eleven-property bulk reader still omits the admitted family claim");
      }), "The original question is not consumer-usable");

      assert(await t.step("superseded or private source context hides both readers and refuses a replay", async () => {
        const cases = [
          { name: "superseded parent", change: `UPDATE public.vehicle_observations SET is_superseded=true WHERE id=${quote(parentId)}::uuid`,
            restore: `UPDATE public.vehicle_observations SET is_superseded=false WHERE id=${quote(parentId)}::uuid` },
          { name: "private vehicle", change: `UPDATE public.vehicles SET is_public=false WHERE id=${quote(VEHICLE)}::uuid`,
            restore: `UPDATE public.vehicles SET is_public=true WHERE id=${quote(VEHICLE)}::uuid` },
        ];
        for (const scenario of cases) {
          try {
            await sql(scenario.change);
            const hidden = await readers();
            equal(hidden.provenance?.observations ?? [], [], `${scenario.name} must hide provenance`);
            equal(hidden.canonical, [], `${scenario.name} must hide canonical state`);
            equal(bulkFamilyClaims(hidden), [], `${scenario.name} must not expose family through bulk specifications`);
            equal((await invoke()).status, 400, `${scenario.name} must be requalified before a duplicate is returned`);
            equal(await countChildren(), 1, `${scenario.name} must preserve the stored testimony without adding another row`);
          } finally {
            await sql(scenario.restore);
          }
        }
        equal((await readers()).canonical.length, 1, "Restoring eligible source context makes existing evidence readable again");
      }), "Source-context revocation is not enforced");

      assert(await t.step("duplicate intake rechecks the child, reviewed proposal and registry state", async () => {
        const cases = [
          { name: "superseded child", status: 503,
            change: `UPDATE public.vehicle_observations SET is_superseded=true WHERE id=${quote(childId)}::uuid`,
            restore: `UPDATE public.vehicle_observations SET is_superseded=false WHERE id=${quote(childId)}::uuid` },
          { name: "withdrawn proposal", status: 503,
            change: `UPDATE public.schema_proposals SET status='withdrawn' WHERE id=${quote(PROPOSAL)}::uuid`,
            restore: `UPDATE public.schema_proposals SET status='approved' WHERE id=${quote(PROPOSAL)}::uuid` },
          { name: "unratified property", status: 400,
            change: "UPDATE public.observation_properties SET namespace='pending' WHERE property_key='engine_family_label'",
            restore: "UPDATE public.observation_properties SET namespace='core' WHERE property_key='engine_family_label'" },
          { name: "changed property unit", status: 503,
            change: "UPDATE public.observation_properties SET unit='liters' WHERE property_key='engine_family_label'",
            restore: "UPDATE public.observation_properties SET unit=NULL WHERE property_key='engine_family_label'" },
          { name: "changed property grain", status: 503,
            change: "UPDATE public.observation_properties SET discriminator_key='engine_position' WHERE property_key='engine_family_label'",
            restore: "UPDATE public.observation_properties SET discriminator_key=NULL WHERE property_key='engine_family_label'" },
          { name: "changed property parent", status: 503,
            change: "UPDATE public.observation_properties SET parent_property_id='8d274b73-a8a6-43bf-9036-5864d0152725' WHERE property_key='engine_family_label'",
            restore: "UPDATE public.observation_properties SET parent_property_id=NULL WHERE property_key='engine_family_label'" },
        ];
        for (const scenario of cases) {
          try {
            await sql(scenario.change);
            const hidden = await readers();
            equal(hidden.provenance?.observations ?? [], [], `${scenario.name} must hide provenance`);
            equal(hidden.canonical, [], `${scenario.name} must hide canonical state`);
            equal(bulkFamilyClaims(hidden), [], `${scenario.name} must not expose family through bulk specifications`);
            const replay = await invoke();
            equal(replay.status, scenario.status, `${scenario.name} must prevent successful duplicate admission`);
            assert(replay.body.success !== true, `${scenario.name} cannot report success`);
            if (scenario.status === 503) equal(replay.body.writes, 0, `${scenario.name} duplicate refusal did not insert`);
            equal(await countChildren(), 1, `${scenario.name} must preserve the sole existing child`);
          } finally {
            await sql(scenario.restore);
          }
        }
        const restored = await invoke();
        equal(restored.status, 200, "Eligible duplicate becomes usable after fixture restoration");
        assert(restored.body.duplicate === true, "Restoration reuses the existing observation");
        equal(restored.body.observation_id, childId, "Restored duplicate keeps its identity");
        equal((await readers()).canonical.length, 1, "Restored evidence is visible to the canonical reader");
      }), "Duplicate admission bypasses result qualification");

      assert(await t.step("a real PostgreSQL result-verification error cannot become duplicate success", async () => {
        try {
          await sql("REVOKE EXECUTE ON FUNCTION public.retained_listing_property_result_matches(uuid,uuid,uuid) FROM service_role");
          const replay = await invoke();
          equal(replay.status, 503, "Unavailable result verification must fail closed");
          assert(replay.body.success !== true, "An RPC failure cannot certify replay");
          equal(replay.body.writes, 0, "Failed duplicate verification did not insert");
          assert(databaseErrors.some((failure) => failure.code === "42501" && failure.message.includes("retained_listing_property_result_matches")), "Exercise actual PostgreSQL RPC permissions rather than a mocked error");
          equal(await countChildren(), 1, "Verification failure leaves testimony intact");
        } finally {
          await sql("GRANT EXECUTE ON FUNCTION public.retained_listing_property_result_matches(uuid,uuid,uuid) TO service_role");
        }
      }), "Result-verification errors are not safely handled");

      assert(await t.step("caller-supplied testimony and unauthenticated selectors cannot use the retained path", async () => {
        equal((await invoke({ structured_data: { engine_family_label: "B48" } })).status, 400, "Selector must reject caller-supplied testimony");
        equal((await invoke({}, "not-a-service-key")).status, 401, "Retained selector must require authorization");
        equal((await invoke({}, PUBLISHABLE_KEY, "apikey")).status, 401, "A publishable key cannot authorize retained intake");
        equal((await invoke({}, legacyToken)).status, 401, "Revoked legacy HS256 service tokens remain refused");
        equal((await invoke({}, userToken)).status, 403, "An authenticated user is not a service caller");
        const apikeyReplay = await invoke({}, SERVICE_KEY, "apikey");
        equal(apikeyReplay.status, 200, "The project secret may arrive on apikey without a bearer token");
        equal(apikeyReplay.body.observation_id, childId, "Both supported service headers preserve result identity");
        equal(apikeyReplay.body.duplicate, true, "A service apikey replay reuses the existing observation");
        equal(await countChildren(), 1, "Rejected callers cannot append another claim");
        equal(inserts, 2, "Only the demonstrated old-guard failure and the single repaired insertion reach PostgreSQL INSERT");
        equal(nativeIdentityInserts, 2, "The unaffected native make and model paths each inserted once");
        equal(await json(`SELECT count(*)::text FROM public.vehicle_observations WHERE source_observation_id=${quote(parentId)}::uuid`), 3,
          "Exactly the family claim and its two native identity siblings exist");
        equal(parentInserts, 1, "Native source testimony was seeded exactly once through the actual handler");
        equal(databaseErrors.length, 2, "Only the expected pre-repair constraint violation and explicit RPC permission failure are allowed");
        equal(bridgeErrors, [], "No unsupported SDK operation or external call occurred");
      }), "Selector authority contract failed");

      assert(await t.step("migration reapplication preserves function definitions, privileges and testimony", async () => {
        const definitions = await functionDefinitions();
        const replayed = await command(["--file", decodeURIComponent(MIGRATION.pathname)]);
        assert(replayed.success, `Migration reapplication failed: ${decoder.decode(replayed.stderr)}`);
        equal(await functionDefinitions(), definitions, "Reapplication is definition-idempotent");
        equal(await functionMetadata(), metadataBefore, "Reapplication preserves ACLs, owners and security/runtime attributes");
        equal(await countChildren(), 1, "Migration reapplication does not append observation rows");
        equal((await readers()).canonical[0]?.observation_id, childId, "The same source-backed result remains consumer-visible");
      }), "Migration reapplication changed the reviewed contract");

      let familyPropertyId: string;
      let replayBeforeQueue: Row;
      let metadataOnlyBefore: Row;
      const queue = (sourceId: string) => json(`SELECT COALESCE(jsonb_agg(to_jsonb(q)),'[]'::jsonb)::text
        FROM public.retained_listing_property_work q WHERE source_observation_id=${quote(sourceId)}::uuid AND property_id=${quote(familyPropertyId)}::uuid`);
      const replayState = () => json("SELECT to_jsonb(r)::text FROM public.retained_listing_property_replay r WHERE id");
      const testimonyCount = () => json(`SELECT count(*)::text FROM public.vehicle_observations WHERE vehicle_id=${quote(VEHICLE)}::uuid`);
      const drain = async () => {
        const response = await handler!(new Request(`${ORIGIN}/functions/v1/ingest-observation`, {
          method: "POST", headers: { "Content-Type": "application/json", apikey: SERVICE_KEY },
          body: JSON.stringify({ mode: DRAIN_MODE, batch_size: 120 }),
        }));
        const body = await response.json();
        equal(bridgeErrors, [], "Queue drain uses only the bounded synthetic PostgreSQL transport");
        equal(response.status, 200, `Queue drain failed: ${JSON.stringify(body)}`);
        assert(body.success === true, `Queue custody failed: ${JSON.stringify(body)}`);
        equal(body.model_calls, 0, "Queue work makes no model calls");
        equal(body.provider_calls, 0, "Queue work makes no external provider calls");
        return body;
      };

      assert(await t.step("the current queue cannot reach the admitted family property and installation stays paused", async () => {
        familyPropertyId = await json(`SELECT to_jsonb(promoted_to_id)::text FROM public.schema_proposals WHERE id=${quote(PROPOSAL)}::uuid`);
        assert(/^[0-9a-f-]{36}$/.test(familyPropertyId), "Use the property ID actually assigned by curator review");
        await sql(`SELECT public.enqueue_retained_listing_properties(ARRAY[${quote(parentId)}::uuid])`);
        equal(await queue(parentId), [], "The existing eleven-property enqueue omits family testimony");
        // These are synthetic queue/replay setup rows, never observation edits.
        await sql(`INSERT INTO public.retained_listing_property_work(source_observation_id,property_id,vehicle_id)
          VALUES(${quote(parentId)}::uuid,${quote(DISPLACEMENT)}::uuid,${quote(VEHICLE)}::uuid) ON CONFLICT DO NOTHING;
          UPDATE public.retained_listing_property_work SET next_attempt_at=now()+interval '1 day' WHERE property_id<>${quote(familyPropertyId)}::uuid;
          UPDATE public.retained_listing_property_replay SET scan_completed_at=coalesce(scan_completed_at,clock_timestamp()),
            native_identity_completed_at=coalesce(native_identity_completed_at,clock_timestamp()) WHERE id`);
        replayBeforeQueue = await replayState();
        metadataOnlyBefore = await json(`SELECT s FROM public.get_vehicle_specs(ARRAY[${quote(VEHICLE)}::uuid]) s`, "anon");
        const before = await testimonyCount();
        const installed = await command(["--file", decodeURIComponent(QUEUE_MIGRATION.pathname)]);
        assert(installed.success, `Queue migration failed: ${decoder.decode(installed.stderr)}`);
        const installedReplay = await replayState();
        for (const [key, value] of Object.entries(replayBeforeQueue)) equal(installedReplay[key], value, `Queue migration preserves prior replay ${key}`);
        equal(installedReplay.engine_family_highwater, parentId, "Family repair pins the finite synthetic displacement source frame");
        equal(installedReplay.engine_family_cursor, null, "New family repair has not visited its frame");
        equal(installedReplay.engine_family_keys_seen, 0, "No family source key is credited during installation");
        equal(installedReplay.engine_family_work_seeded, 0, "No queue work is credited during installation");
        equal(installedReplay.engine_family_completed_at, null, "Installation does not certify repair completion");
        equal(await json("SELECT to_jsonb(active)::text FROM cron.job WHERE jobname='project-retained-listing-properties'"), false,
          "Installation pauses the existing controller");
        const paused = await drain();
        equal(paused.claimed, 0, "No queue claim crosses the paused controller");
        equal(paused.writes, 0, "Paused installation cannot write observations");
        equal(await testimonyCount(), before, "Queue installation never appends testimony");
      }), "Queue installation changed history or bypassed its pause");

      assert(await t.step("finite displacement repair and actual drain reuse the existing family child with verified custody", async () => {
        const before = await testimonyCount();
        await sql("SELECT public.seed_retained_listing_properties()");
        const pending = await queue(parentId);
        equal(pending.length, 1, "Finite displacement repair enqueues exactly one family source-property key");
        equal(pending[0].status, "pending", "Family repair produces work for sanctioned intake");
        equal(pending[0].observation_id, null, "Seeding alone never certifies the already stored result");
        const repairedState = await replayState();
        equal(repairedState.engine_family_cursor, parentId, "Finite repair visits the pinned displacement source");
        equal(repairedState.engine_family_keys_seen, 1, "Exactly one source key is visited in the synthetic repair frame");
        equal(repairedState.engine_family_work_seeded, 1, "The fixture's existing siblings leave only one new family queue key");
        assert(typeof repairedState.engine_family_completed_at === "string", "The exhausted finite frame records completion");
        await sql("SELECT public.seed_retained_listing_properties()");
        equal(await replayState(), repairedState, "Completed finite repair does not restart or revisit keys");
        equal(await queue(parentId), pending, "Repeated seeding does not alter existing custody");
        equal(await json("SELECT to_jsonb(public.activate_retained_listing_property_intake())::text"), true,
          "The existing deployment-owner controller authorizes this synthetic local drain");
        const casWorker = "engine-family-local-cas";
        const claimed = await json(`SELECT COALESCE(jsonb_agg(to_jsonb(c)),'[]'::jsonb)::text FROM public.claim_retained_listing_properties(${quote(casWorker)},1) c`);
        equal(claimed, [{ source_observation_id: parentId, property_id: familyPropertyId, mode: MODE }], "Real SQL claim derives the approved family selector");
        equal(await json(`SELECT to_jsonb(public.finish_retained_listing_property(${quote(parentId)}::uuid,${quote(familyPropertyId)}::uuid,'wrong-worker','done',${quote(childId)}::uuid))::text`), false,
          "A valid result cannot close another worker's lease");
        equal(await json(`SELECT to_jsonb(public.finish_retained_listing_property(${quote(parentId)}::uuid,${quote(familyPropertyId)}::uuid,${quote(casWorker)},'done',${quote(makeId)}::uuid))::text`), false,
          "A native make child cannot certify family work");
        equal((await queue(parentId))[0].status, "claimed", "Failed custody checks leave the real lease intact");
        equal(await json(`SELECT to_jsonb(public.finish_retained_listing_property(${quote(parentId)}::uuid,${quote(familyPropertyId)}::uuid,${quote(casWorker)},'deferred',NULL))::text`), true,
          "Release synthetic test custody through the existing completion function");
        await sql(`UPDATE public.retained_listing_property_work SET next_attempt_at=now() WHERE source_observation_id=${quote(parentId)}::uuid AND property_id=${quote(familyPropertyId)}::uuid`);
        const receipt = await drain();
        equal({ claimed: receipt.claimed, stored: receipt.stored, writes: receipt.writes, duplicates: receipt.duplicates },
          { claimed: 1, stored: 1, writes: 0, duplicates: 1 }, "The real handler drain reuses its existing admitted result");
        const completed = (await queue(parentId))[0];
        equal(completed.status, "done", "Actual PostgreSQL completion stores verified custody");
        equal(completed.observation_id, childId, "Queue custody points to the original family child");
        equal(completed.locked_by, null, "Verified completion releases the lease");
        equal(await testimonyCount(), before, "A duplicate queue replay creates no testimony");
        const state = await readers();
        equal(state.canonical[0]?.observation_id, childId, "Queue completion preserves public answer identity");
        assertBulkFamily(state, childId, parent);
        assert(drainCalls.some(call => call.name === "finish_retained_listing_property" && call.args.p_result === childId && call.args.p_status === "done"),
          "The actual handler must perform its own persisted-result CAS");
      }), "Existing admission was not reachable through the real queue");

      assert(await t.step("bulk specifications preserve source visibility, default metadata and the typed read budget", async () => {
        const metadataOnly = await json(`SELECT s FROM public.get_vehicle_specs(ARRAY[${quote(VEHICLE)}::uuid]) s`, "anon");
        equal(metadataOnly.typed_claims_status, "not_requested", "Default bulk calls remain metadata-only");
        equal(metadataOnly.typed_claims, [], "Default bulk calls do not imply a typed-custody read");
        equal(metadataOnly.retained_record, metadataOnlyBefore.retained_record, "Adding family vocabulary preserves all retained record fields and bindings");
        const oversized = await command(["--command", `SET ROLE anon; SELECT * FROM public.get_vehicle_specs(array_fill(${quote(VEHICLE)}::uuid,ARRAY[21]),true)`]);
        assert(!oversized.success && decoder.decode(oversized.stderr).includes("22023") && decoder.decode(oversized.stderr).includes("at most20"),
          "The actual anonymous bulk reader retains its twenty-key typed budget");
        for (const scenario of [
          { name: "superseded parent", change: `UPDATE public.vehicle_observations SET is_superseded=true WHERE id=${quote(parentId)}::uuid`,
            restore: `UPDATE public.vehicle_observations SET is_superseded=false WHERE id=${quote(parentId)}::uuid` },
          { name: "superseded child", change: `UPDATE public.vehicle_observations SET is_superseded=true WHERE id=${quote(childId)}::uuid`,
            restore: `UPDATE public.vehicle_observations SET is_superseded=false WHERE id=${quote(childId)}::uuid` },
          { name: "private vehicle", change: `UPDATE public.vehicles SET is_public=false WHERE id=${quote(VEHICLE)}::uuid`,
            restore: `UPDATE public.vehicles SET is_public=true WHERE id=${quote(VEHICLE)}::uuid` },
        ]) {
          try {
            await sql(scenario.change);
            const hidden = await readers();
            equal(hidden.provenance?.observations ?? [], [], `${scenario.name} hides provenance after bulk reader expansion`);
            equal(hidden.canonical, [], `${scenario.name} hides canonical state after bulk reader expansion`);
            equal(bulkFamilyClaims(hidden), [], `${scenario.name} hides family from the actual bulk reader`);
            if (scenario.name === "private vehicle") equal(hidden.bulk, [], "The bulk reader exposes no private vehicle metadata");
          } finally { await sql(scenario.restore); }
        }
        assertBulkFamily(await readers(), childId, parent);
      }), "The expanded bulk consumer bypassed existing visibility or read-budget gates");

      assert(await t.step("queue migration reapplication preserves finite progress, completed work and source testimony", async () => {
        const replayBefore = await replayState(), workBefore = await queue(parentId), before = await testimonyCount();
        const activeBefore = await json("SELECT to_jsonb(active)::text FROM cron.job WHERE jobname='project-retained-listing-properties'");
        const reapplied = await command(["--file", decodeURIComponent(QUEUE_MIGRATION.pathname)]);
        assert(reapplied.success, `Queue migration reapplication failed: ${decoder.decode(reapplied.stderr)}`);
        equal(await replayState(), replayBefore, "Reapplication cannot reset any old or family replay progress");
        equal(await queue(parentId), workBefore, "Reapplication preserves the exact completed queue receipt");
        equal(await testimonyCount(), before, "Reapplication leaves testimony untouched");
        equal(await json("SELECT to_jsonb(active)::text FROM cron.job WHERE jobname='project-retained-listing-properties'"), activeBefore,
          "Exact reapplication preserves the controller's existing activation state");
        equal((await drain()).claimed, 0, "Completed repair has no family work to reclaim after reapplication");
      }), "Queue migration reapplication restarted historical work");

      assert(await t.step("new source intake enqueues family work and curator withdrawal blocks replay until restored", async () => {
        const seed = await handler!(new Request(`${ORIGIN}/functions/v1/ingest-observation`, {
          method: "POST", headers: { "Content-Type": "application/json", apikey: SERVICE_KEY },
          body: JSON.stringify({ source_slug: "bat", kind: "listing", vehicle_id: VEHICLE,
            source_url: "https://bringatrailer.com/listing/engine-family-queued-fixture/", source_identifier: "engine-family-queued-fixture:v1",
            observed_at: "2026-10-12T09:45:00.123456Z", extraction_method: "html_description_capture",
            content_text: QUEUED_SOURCE_TEXT, defer_analysis: true, agent_cost_cents: 0,
            structured_data: { extractor: "extract-bat-core", source_text_field: "extract-bat-core.extractDescription",
              description_capture: true, extractor_input_truncated: false, source_capture_basis: "protected_snapshot",
              source_capture_sha256: "b".repeat(64), source_captured_at: "2026-10-12T09:45:00.123456Z",
              observation_time_basis: "source_capture", source_event_time_status: "unknown" },
          }),
        }));
        const seeded = await seed.json();
        equal(seed.status, 200, `Fresh native source failed: ${JSON.stringify(seeded)}`);
        assert(seeded.success === true && seeded.duplicate === false && knownParents.has(seeded.observation_id), "The second native source must use actual sanctioned intake");
        const freshId = seeded.observation_id;
        const pending = await queue(freshId);
        equal(pending.length, 1, "The existing arrival trigger automatically enqueues the new family witness");
        equal(pending[0].status, "pending", "New native evidence waits for sanctioned admission");
        await sql(`UPDATE public.retained_listing_property_work SET next_attempt_at=now()+interval '1 day' WHERE property_id<>${quote(familyPropertyId)}::uuid`);
        for (const gate of [
          { name: "withdrawn proposal", change: `UPDATE public.schema_proposals SET status='withdrawn' WHERE id=${quote(PROPOSAL)}::uuid`,
            restore: `UPDATE public.schema_proposals SET status='approved' WHERE id=${quote(PROPOSAL)}::uuid` },
          { name: "pending registry", change: `UPDATE public.observation_properties SET namespace='pending' WHERE id=${quote(familyPropertyId)}::uuid`,
            restore: `UPDATE public.observation_properties SET namespace='core' WHERE id=${quote(familyPropertyId)}::uuid` },
          { name: "unit drift", change: `UPDATE public.observation_properties SET unit='liters' WHERE id=${quote(familyPropertyId)}::uuid`,
            restore: `UPDATE public.observation_properties SET unit=NULL WHERE id=${quote(familyPropertyId)}::uuid` },
        ]) {
          try {
            await sql(gate.change);
            const state = await replayState(), before = await testimonyCount();
            await sql(`SELECT public.enqueue_retained_listing_properties(ARRAY[${quote(freshId)}::uuid]); SELECT public.seed_retained_listing_properties()`);
            equal(await replayState(), state, `${gate.name} cannot advance family repair`);
            equal((await drain()).claimed, 0, `${gate.name} cannot produce a claim`);
            equal(await queue(freshId), pending, `${gate.name} preserves pending custody without attempting admission`);
            equal(await testimonyCount(), before, `${gate.name} cannot append a family claim`);
            const hidden = await readers();
            equal(hidden.provenance?.observations ?? [], [], `${gate.name} also hides existing family provenance`);
            equal(hidden.canonical, [], `${gate.name} hides canonical family claims`);
            equal(bulkFamilyClaims(hidden), [], `${gate.name} hides family claims from anonymous bulk specifications`);
          } finally { await sql(gate.restore); }
        }
        const before = await testimonyCount();
        const admitted = await drain();
        equal({ claimed: admitted.claimed, stored: admitted.stored, writes: admitted.writes, duplicates: admitted.duplicates },
          { claimed: 1, stored: 1, writes: 1, duplicates: 0 }, "The actual queue dispatch admits the fresh source exactly once");
        const completed = (await queue(freshId))[0];
        equal(completed.status, "done", "Fresh family work finishes only after persisted-result verification");
        assert(completed.observation_id !== childId, "Distinct native captures preserve distinct testimony identities");
        equal(await testimonyCount(), before + 1, "Only one new source-derived family claim is appended");
        const child = await json(`SELECT to_jsonb(o)::text FROM public.vehicle_observations o WHERE id=${quote(completed.observation_id)}::uuid`);
        equal(child.source_observation_id, freshId, "Queue intake retains the new native source parent");
        equal(child.structured_data.source_capture_sha256, "b".repeat(64), "Queue intake preserves the new capture fingerprint");
        equal(child.structured_data.engine_identity_status, "unverified", "Queue completion never certifies physical engine identity");
        const state = await readers();
        equal(state.provenance.observations.length, 2, "Public provenance retains both attributed captures");
        assert(state.provenance.observations.some((o: Row) => o.id === completed.observation_id && o.source_observation_id === freshId), "Fresh queue result is consumer-visible with its source");
        equal(state.canonical[0]?.observation_id, completed.observation_id, "Canonical reader selects the newer source-backed result");
        assertBulkFamily(state, completed.observation_id, await json(`SELECT to_jsonb(o)::text FROM public.vehicle_observations o WHERE id=${quote(freshId)}::uuid`));
        equal((await drain()).claimed, 0, "Completed fresh source work is not claimed again");
        equal(bridgeErrors, [], "No unsupported SDK operation or external call occurred");
        equal(databaseErrors.length, 2, "Queue integration adds no unexpected PostgreSQL failures");
      }), "New source queue integration failed its source-to-public-reader contract");

      assert(await t.step("withdrawal blocks absent arrival work and unfinished finite repair without losing the source", async () => {
        const previousReplay = await replayState();
        let withheldId: string;
        try {
          await sql(`UPDATE public.schema_proposals SET status='withdrawn' WHERE id=${quote(PROPOSAL)}::uuid`);
          const seed = await handler!(new Request(`${ORIGIN}/functions/v1/ingest-observation`, {
            method: "POST", headers: { "Content-Type": "application/json", apikey: SERVICE_KEY },
            body: JSON.stringify({ source_slug: "bat", kind: "listing", vehicle_id: VEHICLE,
              source_url: "https://bringatrailer.com/listing/engine-family-withheld-fixture/", source_identifier: "engine-family-withheld-fixture:v1",
              observed_at: "2026-10-12T10:00:00.123456Z", extraction_method: "html_description_capture",
              content_text: QUEUED_SOURCE_TEXT, defer_analysis: true, agent_cost_cents: 0,
              structured_data: { extractor: "extract-bat-core", source_text_field: "extract-bat-core.extractDescription",
                description_capture: true, extractor_input_truncated: false, source_capture_basis: "protected_snapshot",
                source_capture_sha256: "c".repeat(64), source_captured_at: "2026-10-12T10:00:00.123456Z",
                observation_time_basis: "source_capture", source_event_time_status: "unknown" },
            }),
          }));
          const seeded = await seed.json();
          equal(seed.status, 200, `Withheld native source failed: ${JSON.stringify(seeded)}`);
          assert(seeded.success === true && seeded.duplicate === false && knownParents.has(seeded.observation_id),
            "Curator withdrawal must preserve raw source testimony through sanctioned intake");
          withheldId = seeded.observation_id;
          equal(await queue(withheldId), [], "The actual arrival trigger cannot enqueue a withdrawn family property");
          await sql(`SELECT public.enqueue_retained_listing_properties(ARRAY[${quote(withheldId)}::uuid])`);
          equal(await queue(withheldId), [], "Explicit enqueue cannot create the previously absent family work while withdrawn");
          equal(await json(`SELECT count(*)::text FROM public.retained_listing_property_work WHERE source_observation_id=${quote(withheldId)}::uuid AND property_id=${quote(DISPLACEMENT)}::uuid`), 1,
            "The synthetic source is present in the existing displacement repair frame");
          // Exercise the guard against real unfinished local fixture work. Restore
          // this control state exactly afterwards; never reset production replay.
          await sql(`UPDATE public.retained_listing_property_replay SET engine_family_highwater=${quote(withheldId)}::uuid,
            engine_family_cursor=NULL,engine_family_keys_seen=0,engine_family_work_seeded=0,engine_family_completed_at=NULL WHERE id;
            UPDATE public.retained_listing_property_work SET next_attempt_at=now()+interval '1 day' WHERE property_id<>${quote(familyPropertyId)}::uuid`);
          const unfinished = await replayState();
          await sql("SELECT public.seed_retained_listing_properties()");
          equal(await replayState(), unfinished, "Withdrawn vocabulary cannot advance an unfinished eligible repair frame");
          equal(await queue(withheldId), [], "Unfinished repair cannot enqueue the withdrawn family");
          equal((await drain()).claimed, 0, "The actual worker cannot turn the withheld arrival into a claim");
        } finally {
          await sql(`UPDATE public.schema_proposals SET status='approved' WHERE id=${quote(PROPOSAL)}::uuid;
            UPDATE public.retained_listing_property_replay SET
              (engine_family_highwater,engine_family_cursor,engine_family_keys_seen,engine_family_work_seeded,engine_family_started_at,engine_family_completed_at)=
              (SELECT engine_family_highwater,engine_family_cursor,engine_family_keys_seen,engine_family_work_seeded,engine_family_started_at,engine_family_completed_at
                FROM jsonb_populate_record(NULL::public.retained_listing_property_replay,${quote(JSON.stringify(previousReplay))}::jsonb)) WHERE id`);
        }
        equal(await replayState(), previousReplay, "Synthetic unfinished-frame exercise restores the exact previous progress");
        equal(await json(`SELECT to_jsonb(public.enqueue_retained_listing_properties(ARRAY[${quote(withheldId!)}::uuid]))::text`), 1,
          "Restored curator approval admits exactly the previously withheld queue key");
        equal((await queue(withheldId!))[0].status, "pending", "The preserved source becomes eligible work without a replacement capture");
        const before = await testimonyCount();
        const receipt = await drain();
        equal({ claimed: receipt.claimed, stored: receipt.stored, writes: receipt.writes, duplicates: receipt.duplicates },
          { claimed: 1, stored: 1, writes: 1, duplicates: 0 }, "The existing drain admits the preserved source after approval is restored");
        const completed = (await queue(withheldId!))[0];
        equal(completed.status, "done", "The recovered source receives verified PostgreSQL custody");
        equal(await testimonyCount(), before + 1, "Recovery appends one family claim and preserves its source");
        const state = await readers();
        equal(state.provenance.observations.length, 3, "Public provenance retains all three attributed source captures");
        equal(state.canonical[0]?.observation_id, completed.observation_id, "Recovered source reaches the actual canonical consumer");
        assertBulkFamily(state, completed.observation_id, await json(`SELECT to_jsonb(o)::text FROM public.vehicle_observations o WHERE id=${quote(withheldId!)}::uuid`));
        equal(parentInserts, 3, "All three original captures entered through the actual handler");
        equal(databaseErrors.length, 2, "Negative queue gates cause no unexpected database failures");
        equal(bridgeErrors, [], "No unsupported transport or external call was introduced");
      }), "Withdrawal discarded source evidence or advanced unauthorized repair");
    } finally {
      Deno.serve = originalServe;
      globalThis.fetch = originalFetch;
      for (const [name, value] of saved) {
        if (value === undefined) Deno.env.delete(name);
        else Deno.env.set(name, value);
      }
    }
  },
});
