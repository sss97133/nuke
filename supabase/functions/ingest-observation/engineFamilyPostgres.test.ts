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
const SOURCE_QUOTE = "Powered by a 2.5-liter M50 inline-six paired with a five-speed manual transmission, the car is described by its publisher.";
const ORIGIN = "https://engine-family-fixture.test";
const SERVICE_KEY = "engine-family-local-fixture-service-key";
const MIGRATION = new URL("../../migrations/20261011230939_retained_engine_family_intake.sql", import.meta.url);
type Row = Record<string, any>;

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
          if (!parentId) {
            assert(parentInserts === 0 && body.source_observation_id === undefined && body.property_id === undefined &&
              body.kind === "listing" && body.extraction_method === "html_description_capture" &&
              body.content_text === `This vehicle is described by its publisher with records. ${SOURCE_QUOTE} Factory and current configuration remain unverified.`,
              "Only the one native parent may be seeded through sanctioned intake");
            parentInserts++;
          } else {
            equal(body.source_observation_id, parentId, "Child must reference the handler-created native parent");
            inserts++;
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

    const saved = new Map(["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"].map((name) => [name, Deno.env.get(name)]));
    const originalFetch = globalThis.fetch;
    const originalServe = Deno.serve;
    let handler: ((request: Request) => Promise<Response>) | undefined;
    let parent: Row;
    let parentBefore: string;
    const countChildren = () => json(`SELECT count(*)::text FROM public.vehicle_observations WHERE source_observation_id=${quote(parentId)}::uuid`);
    const readers = () => json(`SELECT jsonb_build_object(
      'provenance',public.get_field_provenance(${quote(VEHICLE)}::uuid,'engine_family_label'),
      'canonical',(SELECT COALESCE(jsonb_agg(to_jsonb(c)),'[]'::jsonb) FROM public.vehicle_canonical c
        JOIN public.observation_properties op ON op.id=c.property_id
        WHERE c.vehicle_id=${quote(VEHICLE)}::uuid AND op.property_key='engine_family_label'))::text`, "anon");
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
    const request = (extra: Row = {}, token = SERVICE_KEY) => new Request(`${ORIGIN}/functions/v1/ingest-observation`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ mode: MODE, source_observation_id: parentId, ...extra }),
    });
    try {
      Deno.env.set("SUPABASE_URL", ORIGIN);
      Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY);
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
          content_text: `This vehicle is described by its publisher with records. ${SOURCE_QUOTE} Factory and current configuration remain unverified.`,
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
      const invoke = async (extra: Row = {}, token = SERVICE_KEY) => {
        const response = await handler!(request(extra, token));
        equal(bridgeErrors, [], "Every SDK request must use the explicitly supported transport");
        return { status: response.status, body: await response.json() };
      };

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
        equal(await countChildren(), 1, "Rejected callers cannot append another claim");
        equal(inserts, 2, "Only the demonstrated old-guard failure and the single repaired insertion reach PostgreSQL INSERT");
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
