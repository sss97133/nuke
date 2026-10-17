/**
 * Opt-in integration contract: the real handler/SDK use a narrow test transport
 * into a disposable PostgreSQL fixture. Database acceptance, triggers, defaults
 * and readers are real. This is not deployed HTTP or PostgREST verification.
 * The fixture is installed by the owning schema contract before this test runs.
 */
import { observationClockMicroseconds } from "../_shared/observationContentHash.ts";
import { descriptionReportedWorkWitnesses, RETAINED_REPORTED_WORK_MODE } from "./retainedReportedWork.ts";
import { proposedDescriptionEngineFamilyLabelWitness } from "./retainedDescriptionPowertrain.ts";

const enabled = Deno.env.get("RUN_ENGINE_FAMILY_PG") === "1";
const VEHICLE = "22222222-2222-4222-8222-222222222222";
const SOURCE = "4cdc735c-f117-42f2-889f-ba33805639a5";
const OTHER_SOURCE = "33333333-3333-4333-8333-333333333333";
const PROPOSAL = "6b9de10b-1666-4bdf-bb69-7e82d62f8b32";
const REVIEWER = "00000000-0000-0000-0000-00000000a001";
const MODE = "retained_listing_engine_family_label_v1";
const IDENTITY_QUOTE = "This 1992 BMW 325i is described by its publisher with records.";
const SOURCE_QUOTE = "Powered by a 2.5-liter M50 inline-six paired with a five-speed manual transmission, the car is described by its publisher.";
const SOURCE_TEXT = `${IDENTITY_QUOTE} ${SOURCE_QUOTE} Factory and current configuration remain unverified.`;
const ORIGIN = "https://engine-family-fixture.test";
const SERVICE_KEY = "sb_secret_engine_family_local_fixture";
const PUBLISHABLE_KEY = "sb_publishable_engine_family_local_fixture";
const MIGRATION = new URL("../../migrations/20261011230939_retained_engine_family_intake.sql", import.meta.url);
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
  observation_properties: ["id", "property_key", "applies_to_kinds", "namespace", "deprecated_at"],
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
    let reportedWorkPhase = false;
    let pendingReportText = "";
    let legacyWorkSeed = false;
    let otherActivitySeed = false;
    let tamperWork: Row | null = null;
    let tamperWorkSource = false;
    let revokeWorkAtResult = false;
    let hideReportSiblings = false;
    const reportParents = new Set<string>();
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
        if (url.pathname === "/rest/v1/rpc/retained_reported_work_result_matches") {
          assert(reportedWorkPhase && request.method === "POST" && url.search === "", "Exact reported result RPC only");
          const args = await request.json();
          equal(Object.keys(args).sort(), ["p_result", "p_source"], "Reported result RPC arguments");
          assert(reportParents.has(args.p_source) && /^[0-9a-f-]{36}$/.test(args.p_result), "Only admitted fixture parents/results");
          if (revokeWorkAtResult) await sql(`UPDATE public.vehicle_observations SET is_superseded=true WHERE id=${quote(args.p_source)}::uuid`);
          return respond(await json(`SELECT to_jsonb(public.retained_reported_work_result_matches(${quote(args.p_source)}::uuid,${quote(args.p_result)}::uuid))::text`, "service_role"));
        }
        if (url.pathname === "/rest/v1/rpc/retained_listing_property_result_matches") {
          assert(request.method === "POST" && url.search === "", "Only the exact result-match RPC POST is supported");
          const args = await request.json();
          equal(Object.keys(args).sort(), ["p_property", "p_result", "p_source"], "Result-match RPC argument names");
          equal(args.p_source, parentId, "Result-match RPC must use the synthetic parent");
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
        const match = url.pathname.match(/^\/rest\/v1\/(vehicles|observation_sources|observation_properties|vehicle_observations)$/);
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
        // Hide intake's same-sentence lookup so the PostgreSQL gate alone decides.
        if (request.method === "GET" && hideReportSiblings && table === "vehicle_observations" &&
          url.searchParams.get("extraction_method") === `eq.${RETAINED_REPORTED_WORK_MODE}`) return respond([]);
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
          assert(body.vehicle_id === VEHICLE && (body.source_id === SOURCE || reportedWorkPhase && body.source_id === OTHER_SOURCE), "Only these synthetic sources/vehicle may be written");
          if (reportedWorkPhase) {
            if (body.kind === "listing") assert(body.content_text === pendingReportText && !body.source_observation_id && !body.property_id, "Only selected native report parents");
            else if (legacyWorkSeed) assert(body.kind === "work_record" && body.structured_data?.item === "Synthetic legacy confirmed work" && !body.source_observation_id, "Only existing confirmed-work control");
            else if (otherActivitySeed) {
              assert(body.kind === "activity" && body.source_id === OTHER_SOURCE && !body.source_observation_id, "Only other-source activity control");
              if (tamperWorkSource) body.source_id = SOURCE;
            }
            else {
              assert(body.kind === "activity" && reportParents.has(body.source_observation_id) && body.extraction_method === RETAINED_REPORTED_WORK_MODE, "Only source-bound report children");
              // Simulate a compromised derived payload at the actual intake-to-DB
              // boundary; the real PostgreSQL insert trigger must reject it.
              if (tamperWork) body.structured_data = { ...body.structured_data, ...tamperWork };
            }
          } else if (!parentId) {
            assert(parentInserts === 0 && body.source_observation_id === undefined && body.property_id === undefined &&
              body.kind === "listing" && body.extraction_method === "html_description_capture" &&
              body.content_text === SOURCE_TEXT,
              "Only the one native parent may be seeded through sanctioned intake");
            parentInserts++;
          } else {
            equal(body.source_observation_id, parentId, "Child must reference the handler-created native parent");
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
        WHERE c.vehicle_id=${quote(VEHICLE)}::uuid AND op.property_key=${quote(key)}))::text`, "anon");
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
      reportedWorkPhase = true;
      const workMigration = new URL("../../migrations/20261015052316_retained_reported_work.sql", import.meta.url);
      const workBaseline = new URL("../../sql/fixtures/retained_reported_work_baseline_20261015.sql", import.meta.url);
      const workQuote = "Work in September 2026 included rebuilding the carburetor, repairing an exhaust leak, and replacing the fuel filter, fuel hoses, and exhaust gaskets.";
      const tiresQuote = "The tires, front struts, and front wheel hubs were replaced in July 2023, an inspection at that time recommended replacing the front brake pads and rotors.";
      const gasketQuote = "The transmission oil pan gasket was replaced and the fluid flushed in July 2023, an inspection at that time recommended flushing the rear differential.";
      const textFor = (quote: string) => `This vehicle is described by its publisher in retained listing text. ${quote} Physical completion has no independent corroboration.`;
      const workInvoke = async (sourceId: string, reportIndex = 0, extra: Row = {}, token = SERVICE_KEY) => {
        const response = await handler!(new Request(`${ORIGIN}/functions/v1/ingest-observation`, {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ mode: RETAINED_REPORTED_WORK_MODE, source_observation_id: sourceId, report_index: reportIndex, ...extra }),
        }));
        equal(bridgeErrors, [], "Reported work must use only sanctioned fixture routes");
        return { status: response.status, data: await response.json() };
      };
      const seedReport = async (text: string, key: string, page = key, capturedAt = "2026-10-10T02:40:06.123456Z") => {
        pendingReportText = text;
        const response = await handler!(new Request(`${ORIGIN}/functions/v1/ingest-observation`, {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
          body: JSON.stringify({ source_slug: "bat", kind: "listing", vehicle_id: VEHICLE,
            source_url: `https://bringatrailer.com/listing/${page}/`, source_identifier: key,
            observed_at: capturedAt, extraction_method: "html_description_capture", content_text: text,
            defer_analysis: true, agent_cost_cents: 0, structured_data: { extractor: "extract-bat-core", source_text_field: "extract-bat-core.extractDescription",
              description_capture: true, extractor_input_truncated: false, source_capture_basis: "direct_fetch", source_capture_sha256: "b".repeat(64),
              source_captured_at: capturedAt, observation_time_basis: "source_capture", source_event_time_status: "unknown" } }),
        }));
        const result = await response.json(); equal(response.status, 200, `Native work parent failed: ${JSON.stringify(result)}`);
        assert(result.success && !result.duplicate, "Source must enter through real native intake");
        reportParents.add(result.observation_id); return result.observation_id as string;
      };
      const workRead = (include = true) => json(`SELECT public.vehicle_build_log_public(${quote(VEHICLE)}::uuid,${include})::text`, "anon");
      const genericActivity = async (slug: string, key: string, token = SERVICE_KEY) => {
        const response = await handler!(new Request(`${ORIGIN}/functions/v1/ingest-observation`, {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ source_slug: slug, kind: "activity", vehicle_id: VEHICLE, observed_at: "2026-09-21T10:00:00Z",
            source_identifier: key, ...(token === SERVICE_KEY ? { defer_analysis: true } : {}), structured_data: { kind_detail: "synthetic_control", intent_status: "unknown" } }),
        }));
        return { status: response.status, data: await response.json() };
      };
      let workParent: string; let mixedParent: string; let workChild: string;
      let originalReader: string; let originalPrivacy: string;
      assert(await t.step("reported work preserves original reader/privacy and refuses unsupported source capability", async () => {
        const setup = await command(["--file", decodeURIComponent(workBaseline.pathname)]);
        assert(setup.success, `Reported baseline failed: ${decoder.decode(setup.stderr)}`);
        originalReader = await sql("SELECT pg_get_functiondef('public.vehicle_build_log_public(uuid)'::regprocedure)");
        originalPrivacy = await sql("SELECT pg_get_functiondef('public.observation_is_public(public.observation_kind,jsonb)'::regprocedure)");
        workParent = await seedReport(textFor(workQuote), "reported-work-fixture");
        const denied = await workInvoke(workParent); equal(denied.status, 400, "Absent source activity capability must refuse");
        equal(denied.data.writes, 0, "No unsupported activity write");
        const sourceBefore = await json(`SELECT to_jsonb(s)::text FROM public.observation_sources s WHERE id=${quote(SOURCE)}::uuid`);
        await sql("CREATE FUNCTION public.retained_reported_work_witnesses(text) RETURNS jsonb LANGUAGE sql AS $$SELECT '[]'::jsonb$$");
        const collision = await command(["--file", decodeURIComponent(workMigration.pathname)]);
        assert(!collision.success && decoder.decode(collision.stderr).includes("helper/overload collision"), "Installation must refuse an existing helper owner");
        await sql("DROP FUNCTION public.retained_reported_work_witnesses(text)");
        const applied = await command(["--file", decodeURIComponent(workMigration.pathname)]);
        assert(applied.success, `Reported migration failed: ${decoder.decode(applied.stderr)}`);
        const sourceAfter = await json(`SELECT to_jsonb(s)::text FROM public.observation_sources s WHERE id=${quote(SOURCE)}::uuid`);
        equal(sourceAfter, { ...sourceBefore, supported_observations: [...sourceBefore.supported_observations, "activity"] }, "Held release only appends activity to the exact existing source");
        equal(await workRead(), { work_records: [], reported_work: [] }, "No report before admitted activity");
        equal(await sql("SELECT pg_get_functiondef('public.vehicle_build_log_public(uuid)'::regprocedure)"), originalReader, "Legacy reader unchanged");
        equal(await sql("SELECT pg_get_functiondef('public.observation_is_public(public.observation_kind,jsonb)'::regprocedure)"), originalPrivacy, "General activity privacy unchanged");
      }), "Reported baseline/capability gate failed");
      assert(await t.step("real intake admits source-bound reports with exact partial date and anonymous provenance", async () => {
        // The held migration enabled the exact synthetic existing source only.
        const admitted = await workInvoke(workParent); equal(admitted.status, 200, JSON.stringify(admitted.data));
        equal(admitted.data.writes, 1, "One admitted report"); workChild = admitted.data.observation_id;
        mixedParent = await seedReport(textFor(`${tiresQuote} ${gasketQuote}`), "reported-mixed-fixture");
        for (const index of [0, 1]) { const r = await workInvoke(mixedParent, index); equal(r.status, 200, JSON.stringify(r.data)); equal(r.data.writes, 1, "Distinct assertion admitted"); }
        const reader = await workRead(); equal(reader.work_records, [], "Reported completion never enters confirmed work");
        equal(reader.reported_work.length, 3, "Honda and two Mercedes reports reach anonymous reader");
        for (const row of reader.reported_work) {
          equal(row.kind, "activity", "Pre-confirmation kind retained"); equal(row.occurrence_status, "unverified", "Occurrence not verified");
          equal(row.independent_source, false, "Report is not independent evidence"); equal(row.intent_status, "unknown", "No inferred intent");
          equal(row.observed_at_basis, "source_testimony_recorded_at", "Reader preserves observation clock basis");
          equal(row.performer_id, null, "No invented performer"); equal(row.performer_status, "unknown", "Explicit unknown performer");
          equal(row.date_precision, "month", "Month precision retained"); assert(!("done_on" in row), "No fabricated exact work date"); equal(row.source_id, SOURCE, "Real source FK");
          equal(row.source_captured_at, "2026-10-10T02:40:06.123456Z", "Capture bytes preserved");
          equal(observationClockMicroseconds(row.observed_at), observationClockMicroseconds(row.source_recorded_at), "Derived observation basis is parent recording");
          assert(observationClockMicroseconds(row.ingested_at)! >= observationClockMicroseconds(row.observed_at)!, "Database child record follows source recording");
          assert(row.confidence_score <= .6, "Report confidence cap");
          if (row.observation_id === workChild) {
            equal(row.reported_date, "2026-09", "No September first fabrication"); equal(row.source_value, workQuote, "Exact Honda quote");
            equal(row.performed_clause, workQuote, "Exact Honda assertion"); equal(row.source_observation_id, workParent, "Typed Honda parent FK");
          } else {
            equal(row.reported_date, "2023-07", "Exact Mercedes month"); assert([tiresQuote, gasketQuote].includes(row.source_value), "Full recommendation context retained");
            assert(!row.performed_clause.includes("recommended"), "Recommendation never becomes performed work"); equal(row.source_observation_id, mixedParent, "Typed Mercedes parent FK");
          }
        }
        equal((await workRead(false)).reported_work, [], "Explicit false excludes activity reports");
        equal(await json(`SELECT coalesce(jsonb_agg(to_jsonb(w)),'[]'::jsonb)::text FROM public.vehicle_build_log_public(${quote(VEHICLE)}::uuid) w`, "anon"), [], "One-argument reader unchanged");
        equal(await json(`SELECT to_jsonb(count(*))::text FROM public.vehicle_observations WHERE kind='activity'`, "anon"), 0, "General activity RLS stays private");
        const replay = await workInvoke(workParent); equal(replay.data.observation_id, workChild, "Replay keeps original child UUID");
        equal(replay.data.writes, 0, "Replay adds no testimony"); equal(replay.data.duplicate, true, "Replay is validated duplicate");
      }), "Reported source-to-consumer contract failed");
      assert(await t.step("recommended and forged claims fail both protected selector and PostgreSQL admission", async () => {
        for (const extra of [{ reported_date: "2026-09-01" }, { performer_id: REVIEWER }, { source_value: workQuote }, { occurrence_status: "confirmed" }, { structured_data: { analysis_kind: "retained_reported_work" } }]) {
          const result = await workInvoke(workParent, 0, extra); equal(result.status, 400, "Caller cannot normalize protected fields"); equal(result.data.writes, 0, "Forged selector writes zero");
        }
        for (const token of [PUBLISHABLE_KEY, userToken]) assert((await workInvoke(workParent, 0, {}, token)).status >= 400, "Nonservice admission refused");
        for (const token of [SERVICE_KEY, userToken]) {
          const generic = await genericActivity("bat", "generic-bat-refusal", token);
          equal(generic.status, 403, "BaT capability cannot authorize generic activity"); equal(generic.data.writes, 0, "Generic BaT refusal has no writes");
        }
        otherActivitySeed = true;
        try {
          const other = await genericActivity("reported-work-control", "other-activity-control");
          equal(other.status, 200, JSON.stringify(other.data)); assert(other.data.success, "Other-source activity remains supported");
          tamperWorkSource = true;
          const converted = await genericActivity("reported-work-control", "other-activity-forged-bat");
          equal(converted.status, 500, "Independent DB gate refuses a BaT activity payload without protected method/source FK");
          assert(databaseErrors.at(-1)?.message.includes("BaT activity requires protected retained report admission"), "Specific source capability guard fired");
        } finally { otherActivitySeed = false; tamperWorkSource = false; }
        const recommended = await seedReport(textFor("An inspection in July 2023 recommended replacing the front brake pads and rotors."), "recommendation-fixture");
        equal((await workInvoke(recommended)).status, 400, "Recommendation-only source refuses");
        const forgedParent = await seedReport(textFor(workQuote), "forged-report-fixture");
        const errorsBefore = databaseErrors.length;
        for (const [key, value] of Object.entries({ reported_date: "2026-09-01", performer_status: "known", performer_id: REVIEWER,
          occurrence_status: "confirmed", source_capture_sha256: "f".repeat(64), performed_clause: "replacing the front brake pads and rotors" })) {
          tamperWork = { [key]: value };
          try { equal((await workInvoke(forgedParent)).status, 500, `Database must refuse forged ${key}`); }
          finally { tamperWork = null; }
        }
        equal(databaseErrors.length - errorsBefore, 6, "Every compromised intake payload reached the independent PostgreSQL guard");
        assert(databaseErrors.slice(errorsBefore).every(e => e.code === "23514" && e.message.includes("Retained reported work must match exact public source assertion")), "Only intended custody refusals");
        for (const sample of [textFor(workQuote), textFor(`${tiresQuote} ${gasketQuote}`), textFor("Work in September 2026 included not rebuilding the carburetor."),
          textFor("Work in September 2026 included rebuilding the carburetor, pending approval."), textFor("Work in September 2026 included rebuilding the carburetor, subject to approval."),
          textFor("Work in September 2026 included rebuilding the carburetor, as a hypothetical example."), textFor("Work in September 2026 included replacing the tires, except this was canceled."),
          textFor("Service in March 2026 included replacing the tubes, tires, and more."),
          textFor(`Not performed:\n${workQuote}`), textFor(`The work was never completed.\n${workQuote}`), textFor(`Recommended work:\n${workQuote}`), textFor(`The following work was not performed:\n${workQuote}`), textFor(`\u00a0${workQuote}`)])
          equal(await json(`SELECT public.retained_reported_work_witnesses(${quote(sample)})::text`), descriptionReportedWorkWitnesses(sample), "Independent SQL and intake witnesses agree");
      }), "Reported refusal contract failed");
      assert(await t.step("anonymous report visibility follows parent custody and current source capability", async () => {
        for (const [change, restore] of [
          [`UPDATE public.vehicle_observations SET is_superseded=true WHERE id=${quote(workParent)}::uuid`, `UPDATE public.vehicle_observations SET is_superseded=false WHERE id=${quote(workParent)}::uuid`],
          [`UPDATE public.vehicle_observations SET structured_data=structured_data||'{"receipt_id":"private"}'::jsonb WHERE id=${quote(workParent)}::uuid`, `UPDATE public.vehicle_observations SET structured_data=structured_data-'receipt_id' WHERE id=${quote(workParent)}::uuid`],
          [`UPDATE public.vehicles SET is_public=false WHERE id=${quote(VEHICLE)}::uuid`, `UPDATE public.vehicles SET is_public=true WHERE id=${quote(VEHICLE)}::uuid`],
          [`UPDATE public.observation_sources SET supported_observations=array_remove(supported_observations,'activity'::public.observation_kind) WHERE id=${quote(SOURCE)}::uuid`, `UPDATE public.observation_sources SET supported_observations=array_append(supported_observations,'activity'::public.observation_kind) WHERE id=${quote(SOURCE)}::uuid`],
        ]) {
          await sql(change);
          try { assert(!(await workRead()).reported_work.some((r: Row) => r.observation_id === workChild), "Revoked report withheld"); assert((await workInvoke(workParent)).status >= 400, "Replay cannot bless a revoked source"); }
          finally { await sql(restore); }
        }
        equal((await workRead()).reported_work.length, 3, "All unchanged sources restore visibility");
        // Revoke after the selector and hash replay read, immediately before the
        // actual result RPC. This is a deterministic late-boundary test, not a
        // claim to exercise concurrent transactions.
        revokeWorkAtResult = true;
        try {
          const late = await workInvoke(workParent); equal(late.status, 503, "Late parent withdrawal prevents success");
          equal(late.data.writes, 0, "Late replay adds no testimony"); assert(!late.data.success, "No stale duplicate success");
          assert(!(await workRead()).reported_work.some((r: Row) => r.observation_id === workChild), "Late-withdrawn parent also withholds reader output");
        } finally { revokeWorkAtResult = false; await sql(`UPDATE public.vehicle_observations SET is_superseded=false WHERE id=${quote(workParent)}::uuid`); }
      }), "Reported withdrawal/custody contract failed");
      assert(await t.step("confirmed work remains unchanged and reported migration reapplication adds no testimony", async () => {
        legacyWorkSeed = true;
        const response = await handler!(new Request(`${ORIGIN}/functions/v1/ingest-observation`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
          body: JSON.stringify({ source_slug: "reported-work-control", kind: "work_record", vehicle_id: VEHICLE, observed_at: "2026-09-21T10:00:00Z", source_identifier: "legacy-confirmed-control",
            structured_data: { item: "Synthetic legacy confirmed work", transaction_date: "2026-09-20", labor_minutes: 0, build_stage: "maintenance" }, defer_analysis: true }) }));
        legacyWorkSeed = false; equal(response.status, 200, `Legacy control intake: ${await response.text()}`);
        const legacy = await json(`SELECT coalesce(jsonb_agg(to_jsonb(w)),'[]'::jsonb)::text FROM public.vehicle_build_log_public(${quote(VEHICLE)}::uuid) w`, "anon");
        equal(legacy.length, 1, "One existing confirmed control"); equal(legacy[0].done_on, "2026-09-20", "Legacy exact work date preserved");
        equal((await workRead()).work_records, legacy, "Opt-in preserves legacy rows"); equal((await workRead(false)).work_records, legacy, "False opt-in preserves legacy rows");
        const before = await json("SELECT to_jsonb(count(*))::text FROM public.vehicle_observations");
        const reapplied = await command(["--file", decodeURIComponent(workMigration.pathname)]); assert(reapplied.success, `Reapply failed: ${decoder.decode(reapplied.stderr)}`);
        equal(await json("SELECT to_jsonb(count(*))::text FROM public.vehicle_observations"), before, "No migration testimony mutation");
        equal((await workRead()).reported_work.length, 3, "Reports survive exact reapplication"); equal((await workRead()).work_records, legacy, "Confirmed control unchanged");
        const witnessDefinition = await sql("SELECT pg_get_functiondef('public.retained_reported_work_witnesses(text)'::regprocedure)");
        await sql("CREATE OR REPLACE FUNCTION public.retained_reported_work_witnesses(p_text text) RETURNS jsonb LANGUAGE sql AS $$SELECT '[]'::jsonb$$");
        try {
          const drifted = await command(["--file", decodeURIComponent(workMigration.pathname)]);
          assert(!drifted.success && decoder.decode(drifted.stderr).includes("Reported-work owner drift"), "Reapplication must refuse drifted helper definitions");
        } finally { await sql(witnessDefinition); }
        equal(bridgeErrors, [], "No external call or unsupported route");
      }), "Reported legacy/reapplication contract failed");
      assert(await t.step("a repeated capture of one listing sentence adds no second public report", async () => {
        // Live 2026-10-15: each first-admission vehicle held 15-16 identical captures of one listing page.
        const sameSentence = () => json(`SELECT to_jsonb(count(*))::text FROM public.vehicle_observations WHERE vehicle_id=${quote(VEHICLE)}::uuid
          AND kind='activity' AND extraction_method=${quote(RETAINED_REPORTED_WORK_MODE)} AND structured_data->>'source_value'=${quote(workQuote)}`);
        const honda = async () => (await workRead()).reported_work.filter((r: Row) => r.source_value === workQuote);
        const recapture = await seedReport(textFor(workQuote), "reported-work-fixture-recapture", "reported-work-fixture", "2026-10-12T03:00:00.654321Z");
        const repeated = await workInvoke(recapture); equal(repeated.status, 200, JSON.stringify(repeated.data));
        equal([repeated.data.duplicate, repeated.data.writes, repeated.data.observation_id, repeated.data.admitted_source_observation_id],
          [true, 0, workChild, workParent], "A later capture replays the existing report");
        equal(await sameSentence(), 1, "No second child for one listing sentence");
        hideReportSiblings = true;
        const errorsBefore = databaseErrors.length;
        try { equal((await workInvoke(recapture)).status, 500, "PostgreSQL refuses a repeated report the intake lookup missed"); }
        finally { hideReportSiblings = false; }
        assert(databaseErrors.slice(errorsBefore).some(e => e.code === "23514" && e.message.includes("already admitted for this listing sentence")), "Specific same-sentence refusal");
        equal(await sameSentence(), 1, "Refused repeat leaves one child");
        equal((await workRead()).reported_work.length, 3, "Public report count unchanged by repeated captures");
        await sql(`UPDATE public.vehicle_observations SET is_superseded=true WHERE id=${quote(workParent)}::uuid`);
        let surviving = "";
        try {
          const readmitted = await workInvoke(recapture); equal(readmitted.status, 200, JSON.stringify(readmitted.data));
          equal([readmitted.data.duplicate, readmitted.data.writes], [false, 1], "A surviving capture may carry a report whose capture was withdrawn");
          surviving = readmitted.data.observation_id; equal((await honda()).map((r: Row) => r.observation_id), [surviving], "One report, from the surviving capture");
        } finally { await sql(`UPDATE public.vehicle_observations SET is_superseded=false WHERE id=${quote(workParent)}::uuid`); }
        assert(surviving && surviving !== workChild, "The surviving capture's report is its own child");
        equal((await honda()).map((r: Row) => r.observation_id), [workChild], "Both captures current: the reader shows the earliest report once");
        equal((await workRead()).reported_work.length, 3, "Collapsed reader keeps one report per listing sentence");
        const relisting = await seedReport(textFor(workQuote), "reported-work-relisting", "reported-work-relisting", "2026-10-13T04:00:00.111111Z");
        const another = await workInvoke(relisting); equal([another.status, another.data.writes], [200, 1], "A different listing page is a separate publication");
        equal((await honda()).length, 2, "One report per listing page, each with its own source URL");
        equal(bridgeErrors, [], "No external call or unsupported route");
      }), "Reported repeated-capture contract failed");
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
