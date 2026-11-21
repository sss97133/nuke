// deno test --node-modules-dir=none supabase/functions/vehicle-agent/scope.test.ts
import {
  namesAnotherVehicle, normalizeProposals, PROPOSAL_TTL_MS, signProposal, speakerRole, splitReply, verifyProposal,
  WRITERS, type SignedPayload,
} from "./scope.ts";

function assert(cond: unknown, msg = "assertion failed"): asserts cond { if (!cond) throw new Error(msg); }
function eq(a: unknown, b: unknown, msg = "") {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

const CAR = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";
const SECRET = "test-secret-not-real";

Deno.test("pin: another vehicle's id anywhere, or a vehicle-naming key, is refused", () => {
  assert(!namesAnotherVehicle({ note: `this car ${CAR}` }, CAR));
  assert(namesAnotherVehicle({ note: `see ${OTHER}` }, CAR));
  assert(namesAnotherVehicle({ fields: { nested: [{ ref: OTHER.toUpperCase() }] } }, CAR));
  assert(namesAnotherVehicle({ vehicle_id: CAR }, CAR), "a vehicle key is refused even when it names this car");
  assert(namesAnotherVehicle({ duplicate_id: "x" }, CAR));
  assert(namesAnotherVehicle({ [OTHER]: 1 }, CAR), "ids in keys count");
  assert(!namesAnotherVehicle({ vin: "1G1YY22G965100001", vehicle_color: "red" }, CAR));
});

Deno.test("allow-list: only the two writers; the correction and merge writers are not on it", () => {
  eq(Object.keys(WRITERS).sort(), ["ingest_observation", "record_vehicle_statement"]);
  const { proposals, refused } = normalizeProposals({
    proposals: [
      { writer: "correct_vehicle_vin", value: "X" },
      { writer: "propose_vehicle_merge", duplicate: OTHER },
      { writer: "execute_sql", sql: "delete from vehicles" },
    ],
  }, { vehicleId: CAR, userMessage: "hi" });
  eq(proposals.length, 0);
  eq(refused.map((r) => r.reason), ["writer not allowed", "writer not allowed", "writer not allowed"]);
});

Deno.test("statement proposal keeps the person's own words, never the model's", () => {
  const { proposals } = normalizeProposals({
    proposals: [{ writer: "record_vehicle_statement", statement_kind: "assertion", statement: "MODEL WORDS", summary: "model summary", target_key: "rear_axle_type", target_value: "posi" }],
  }, { vehicleId: CAR, userMessage: "the rear axle is posi" });
  eq(proposals.length, 1);
  const p = proposals[0];
  eq(p.writer, "record_vehicle_statement");
  eq((p.args as any).statement, "the rear axle is posi");
  assert(!p.summary.includes("MODEL WORDS") && !p.summary.includes("model summary"), "summary is built server-side");
  assert(p.summary.includes("the rear axle is posi"));
});

Deno.test("statement proposal validates kind and target pair", () => {
  const run = (item: Record<string, unknown>) =>
    normalizeProposals({ proposals: [{ writer: "record_vehicle_statement", ...item }] }, { vehicleId: CAR, userMessage: "words" });
  eq(run({ statement_kind: "rumour" }).refused[0].reason, "unknown statement kind");
  eq(run({ statement_kind: "assertion", target_key: "a" }).refused[0].reason, "a target is a key and a value together");
  eq(run({ statement_kind: "assertion", target_key: "Bad Key", target_value: "x" }).refused[0].reason, "target key is not lower_snake_case");
  eq(run({ statement_kind: "estimate" }).proposals.length, 1);
  eq(normalizeProposals({ proposals: [{ writer: "record_vehicle_statement", statement_kind: "assertion" }] }, { vehicleId: CAR, userMessage: "  " }).refused[0].reason, "no words to keep");
});

Deno.test("observation proposal: allowed kinds only, other vehicle refused, at most three", () => {
  const ok = { writer: "ingest_observation", kind: "condition", summary: "rust at the rocker", fields: {}, confidence: "medium" };
  eq(normalizeProposals({ proposals: [{ ...ok, kind: "sale" }] }, { vehicleId: CAR, userMessage: "" }).refused[0].reason, "kind not allowed");
  eq(normalizeProposals({ proposals: [{ ...ok, fields: { other: OTHER } }] }, { vehicleId: CAR, userMessage: "" }).refused[0].reason, "names another vehicle");
  eq(normalizeProposals({ proposals: [{ ...ok, vehicle_id: OTHER }] }, { vehicleId: CAR, userMessage: "" }).refused[0].reason, "names another vehicle");
  const many = normalizeProposals({ proposals: [ok, ok, ok, ok] }, { vehicleId: CAR, userMessage: "" });
  eq(many.proposals.length, 3);
  eq(many.refused[0].reason, "too many proposals");
  eq((normalizeProposals({ proposals: [{ ...ok, confidence: "verified" }] }, { vehicleId: CAR, userMessage: "" }).proposals[0].args as any).confidence, "low");
});

Deno.test("splitReply separates prose from a trailing json block, tolerating bad json", () => {
  const raw = "It has posi.\n```json\n{\"proposals\":[]}\n```";
  eq(splitReply(raw), { reply: "It has posi.", block: { proposals: [] } });
  eq(splitReply("plain").block, null);
  eq(splitReply("x\n```json\n{bad\n```").block, null);
});

async function signed(overrides: Partial<SignedPayload> = {}) {
  const { proposals } = normalizeProposals({ proposals: [{ writer: "ingest_observation", kind: "condition", summary: "dent", confidence: "low" }] }, { vehicleId: CAR, userMessage: "" });
  const payload = { ...proposals[0], v: 1, id: crypto.randomUUID(), user_id: USER, vehicle_id: CAR, model: "m", exp: Date.now() + PROPOSAL_TTL_MS, ...overrides } as SignedPayload;
  return { payload, token: await signProposal(payload, SECRET) };
}

Deno.test("confirm: a signed proposal verifies for its account and car only", async () => {
  const { payload, token } = await signed();
  const ctx = { userId: USER, vehicleId: CAR, now: Date.now() };
  const ok = await verifyProposal(token, SECRET, ctx);
  assert(ok.ok, "valid token");
  eq(ok.ok && ok.value.id, payload.id);
  eq(await verifyProposal(token, SECRET, { ...ctx, vehicleId: OTHER }), { ok: false, reason: "made for another vehicle" });
  eq(await verifyProposal(token, SECRET, { ...ctx, userId: OTHER }), { ok: false, reason: "made for another account" });
  eq(await verifyProposal(token, "another-secret", ctx), { ok: false, reason: "not a proposal this agent made" });
  eq(await verifyProposal(token, SECRET, { ...ctx, now: Date.now() + PROPOSAL_TTL_MS + 1000 }), { ok: false, reason: "expired" });
});

Deno.test("confirm: a client-edited proposal fails the signature", async () => {
  const { token } = await signed();
  const [body, sig] = token.split(".");
  const payload = JSON.parse(atob(body.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - body.length % 4) % 4)));
  payload.writer = "record_vehicle_statement";
  payload.args = { statement: "forged", statement_kind: "assertion", target_key: null, target_value: null };
  const forged = btoa(JSON.stringify(payload)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "") + "." + sig;
  eq(await verifyProposal(forged, SECRET, { userId: USER, vehicleId: CAR, now: Date.now() }), { ok: false, reason: "not a proposal this agent made" });
  eq(await verifyProposal("garbage", SECRET, { userId: USER, vehicleId: CAR, now: Date.now() }), { ok: false, reason: "not a proposal" });
  eq(await verifyProposal({ writer: "x" }, SECRET, { userId: USER, vehicleId: CAR, now: Date.now() }), { ok: false, reason: "not a proposal" });
});

Deno.test("confirm: a signed proposal whose writer later leaves the allow-list is refused", async () => {
  const { token } = await signed({ writer: "correct_vehicle_vin" as any });
  eq(await verifyProposal(token, SECRET, { userId: USER, vehicleId: CAR, now: Date.now() }), { ok: false, reason: "writer not allowed" });
});

Deno.test("speaker role: closed list; owner only when the record names the caller", () => {
  eq(speakerRole(undefined, true), { ok: true, value: "owner" });
  eq(speakerRole(undefined, false), { ok: true, value: "representative" });
  eq(speakerRole("shop", false), { ok: true, value: "shop" });
  eq(speakerRole("owner", false), { ok: false, reason: "the car's record does not name you as its owner" });
  eq(speakerRole("admin", true), { ok: false, reason: "unknown role" });
});
