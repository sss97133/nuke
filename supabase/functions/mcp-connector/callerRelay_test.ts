// Run: deno test --node-modules-dir=none supabase/functions/mcp-connector/callerRelay_test.ts
// The write tools act for the credential that called them (callerRelay.ts): a stranger's login is refused the
// vehicle, an owner's passes, and only the service key acts for someone else.
import { callerMayEditVehicle, callerRelayHeaders, scopedObservation, scopedPhotoIngest, type Rpc } from "./callerRelay.ts";

const OWNER = "10000000-0000-4000-8000-000000000001";
const STRANGER = "20000000-0000-4000-8000-000000000002";
const CAR = "30000000-0000-4000-8000-000000000003";
const SERVICE = { userId: "service-role", scopes: ["admin"] };
const ownerLogin = { userId: OWNER, scopes: ["read", "write:observations"], oauthToken: "nuke_oauth_" + "a".repeat(64) };
const strangerKey = { userId: STRANGER, scopes: ["read", "write:observations"], apiKey: "nk_live_stranger" };
const agentKey = { userId: "agent:a1", scopes: ["read", "write:observations"], apiKey: "nk_live_agent" };

const asked: Array<Record<string, unknown>> = [];
// user_can_edit_vehicle answers true only for the owner on CAR.
const rpc: Rpc = (fn, args) => {
  asked.push({ fn, ...args });
  return Promise.resolve({ data: fn === "user_can_edit_vehicle" && args.p_user_id === OWNER && args.p_vehicle_id === CAR, error: null });
};
const failing: Rpc = () => Promise.resolve({ data: null, error: { message: "down" } });

function assert(ok: unknown, msg: string): asserts ok { if (!ok) throw new Error(msg); }

Deno.test("relay headers: the service key for the service key, the caller's own credential for anyone else", () => {
  assert(callerRelayHeaders(SERVICE, "svc")?.Authorization === "Bearer svc", "service lost its key");
  const login = callerRelayHeaders(ownerLogin, "svc")!;
  assert(login["X-API-Key"] === ownerLogin.oauthToken && !("Authorization" in login), "a login was relayed with the service key");
  const key = callerRelayHeaders(strangerKey, "svc")!;
  assert(key["X-API-Key"] === "nk_live_stranger" && !("Authorization" in key), "an API key was relayed with the service key");
  assert(callerRelayHeaders(undefined, "svc") === null, "no caller got a credential");
  assert(callerRelayHeaders({ userId: OWNER }, "svc") === null, "a caller with nothing to forward got the service key");
});

Deno.test("vehicle right: owner passes, stranger and agent are refused, a failed lookup refuses", async () => {
  assert(await callerMayEditVehicle(rpc, SERVICE, CAR), "service refused");
  assert(await callerMayEditVehicle(rpc, ownerLogin, CAR), "owner refused");
  assert(!(await callerMayEditVehicle(rpc, strangerKey, CAR)), "stranger admitted");
  assert(!(await callerMayEditVehicle(rpc, agentKey, CAR)), "an agent key with no user admitted");
  assert(!(await callerMayEditVehicle(rpc, ownerLogin, "not-a-uuid")), "a malformed vehicle id admitted");
  assert(!(await callerMayEditVehicle(failing, ownerLogin, CAR)), "a failed lookup admitted");
});

Deno.test("submit_observation: owner_confirmed stays for the owner, is dropped for a stranger; the caller is the person", async () => {
  const args = { vehicle_id: CAR, source_slug: "owner-input", kind: "work_record", structured_data: { owner_confirmed: true, a: 1 },
    submitted_by_user_id: OWNER };
  const stranger = await scopedObservation(rpc, strangerKey, args);
  const sd = stranger.body.structured_data as Record<string, unknown>;
  assert(stranger.ownerConfirmedDropped && !("owner_confirmed" in sd) && sd.a === 1, "a stranger kept the owner's sign-off");
  assert(!("submitted_by_user_id" in stranger.body), "a stranger named another person as submitter");
  assert(JSON.stringify(stranger.body.observer_raw) === JSON.stringify({ via: "mcp-connector", user_id: STRANGER }), "the stranger was not recorded");
  assert((args.structured_data as Record<string, unknown>).owner_confirmed === true, "the caller's arguments were mutated");
  const owner = await scopedObservation(rpc, ownerLogin, args);
  assert(!owner.ownerConfirmedDropped && (owner.body.structured_data as Record<string, unknown>).owner_confirmed === true, "the owner lost the sign-off");
  const service = await scopedObservation(rpc, SERVICE, args);
  assert((service.body.structured_data as Record<string, unknown>).owner_confirmed === true && service.body.submitted_by_user_id === OWNER,
    "the service key lost its fields");
  const before = asked.length;
  const none = await scopedObservation(rpc, strangerKey, { ...args, structured_data: { a: 1 } });
  assert(!none.ownerConfirmedDropped && asked.length === before, "an observation without a sign-off asked for the vehicle right");
  const falsy = await scopedObservation(rpc, ownerLogin, { ...args, structured_data: { owner_confirmed: "yes" } });
  assert(!("owner_confirmed" in (falsy.body.structured_data as Record<string, unknown>)), "a non-boolean sign-off passed");
});

Deno.test("ingest_photos: a stranger's photos land unassigned and documented as the stranger, never by upsert", async () => {
  const args = { vehicle_id: CAR, user_id: OWNER, source: "../x" };
  const stranger = await scopedPhotoIngest(rpc, strangerKey, args, CAR);
  assert(stranger.vehicleId === null && stranger.vehicleRefused, "a stranger's photos landed on the car");
  assert(stranger.documentedBy === STRANGER, "a stranger documented photos as someone else");
  assert(stranger.upsert === false && stranger.source === "ai_ingest", "a stranger could overwrite or escape the path");
  const n1 = stranger.storageName("a b.jpg"), n2 = stranger.storageName("a b.jpg");
  assert(n1 !== n2 && n1.endsWith("_a_b.jpg"), "storage names repeat or keep unsafe characters");
  const owner = await scopedPhotoIngest(rpc, ownerLogin, args, CAR);
  assert(owner.vehicleId === CAR && !owner.vehicleRefused && owner.documentedBy === OWNER && owner.upsert === false, "the owner was refused");
  const agent = await scopedPhotoIngest(rpc, agentKey, args, null);
  assert(agent.vehicleId === null && !agent.vehicleRefused && agent.documentedBy === null, "an agent key gained a person");
  const service = await scopedPhotoIngest(rpc, SERVICE, args, CAR);
  assert(service.vehicleId === CAR && service.documentedBy === OWNER && service.upsert === true && service.storageName("p.jpg") === "p.jpg",
    "the service key's behaviour changed");
});

Deno.test("the three write tools in index.ts go through these helpers", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  const body = (name: string) => {
    const a = src.indexOf(`async function ${name}(`);
    assert(a >= 0, `${name} missing`);
    const b = src.indexOf("\n}\n", a);
    return src.slice(a, b);
  };
  const event = body("handleSubmitVehicleEvent");
  assert(/callerRelayHeaders\(caller, SERVICE_ROLE_KEY\)/.test(event) && !/SERVICE_ROLE_KEY\}`/.test(event),
    "submit_vehicle_event sends the service key itself");
  const obs = body("handleSubmitObservation");
  assert(/scopedObservation\(.*, caller, args\)/.test(obs) && !/submitted_by_user_id/.test(obs), "submit_observation bypasses scopedObservation");
  const photos = body("handleIngestPhotos");
  assert(/scopedPhotoIngest\(.*, caller, args, resolvedVehicleId\)/.test(photos) && /resolvedVehicleId = scope\.vehicleId/.test(photos) &&
    /upsert: scope\.upsert/.test(photos) && !/args\.user_id/.test(photos), "ingest_photos bypasses scopedPhotoIngest");
});
