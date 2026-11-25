import { assertEquals } from "jsr:@std/assert@1";
import { decideTransferAccess, scopeBodyToCaller, storableSignalMetadata, type TransferParties } from "./partyGate.ts";

const T = "11111111-1111-4111-8111-111111111111";
const OTHER_T = "22222222-2222-4222-8222-222222222222";
const SELLER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BUYER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const STRANGER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const BUYER_TOKEN = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const SELLER_TOKEN = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const OTHER_TOKEN = "ffffffff-ffff-4fff-8fff-ffffffffffff";

const ROWS: Record<string, TransferParties> = {
  [T]: { from_user_id: SELLER, to_user_id: BUYER, buyer_access_token: BUYER_TOKEN, seller_access_token: SELLER_TOKEN },
  [OTHER_T]: { from_user_id: STRANGER, to_user_id: null, buyer_access_token: OTHER_TOKEN, seller_access_token: null },
};
const load = (id: string) => Promise.resolve(ROWS[id] ?? null);
const user = (id: string | null) => ({ privileged: false, userId: id });
const complete = (transfer_id: string, extra: Record<string, unknown> = {}) =>
  ({ action: "advance_manual", transfer_id, milestone_type: "transfer_complete", ...extra });

Deno.test("a signed-in stranger cannot complete someone else's transfer (the HIGH)", async () => {
  const a = await decideTransferAccess(complete(T), user(STRANGER), load);
  assertEquals(a.ok, false);
});

Deno.test("the seller or the buyer of that transfer may advance it, named as themself", async () => {
  for (const id of [SELLER, BUYER]) {
    const a = await decideTransferAccess(complete(T, { completed_by_user_id: STRANGER }), user(id), load);
    assertEquals(a, { ok: true, via: "party_user", actingUserId: id });
    const body = scopeBodyToCaller(complete(T, { completed_by_user_id: STRANGER, user_id: STRANGER }), a);
    assertEquals([body.completed_by_user_id, body.user_id], [id, id]);
  }
});

Deno.test("a party of one transfer cannot act on another", async () => {
  const a = await decideTransferAccess(complete(OTHER_T), user(SELLER), load);
  assertEquals(a.ok, false);
});

Deno.test("the token path is bound to its own transfer", async () => {
  const own = await decideTransferAccess(complete(T, { access_token: BUYER_TOKEN }), user(null), load);
  assertEquals(own, { ok: true, via: "party_token", actingUserId: null });
  const viaMeta = await decideTransferAccess(
    { action: "ingest_signal", transfer_id: T, signal_text: "x", signal_metadata: { token: SELLER_TOKEN } },
    user(null),
    load,
  );
  assertEquals(viaMeta.ok, true);
  // a valid token for transfer OTHER_T does not open transfer T, and T's token does not open OTHER_T
  assertEquals((await decideTransferAccess(complete(T, { access_token: OTHER_TOKEN }), user(null), load)).ok, false);
  assertEquals((await decideTransferAccess(complete(OTHER_T, { access_token: BUYER_TOKEN }), user(null), load)).ok, false);
  // a stranger signed in with T's token still acts as nobody
  const s = await decideTransferAccess(complete(T, { access_token: BUYER_TOKEN }), user(STRANGER), load);
  assertEquals(s, { ok: true, via: "party_token", actingUserId: null });
  const body = scopeBodyToCaller(complete(T, { access_token: BUYER_TOKEN, completed_by_user_id: STRANGER }), s);
  assertEquals(body.completed_by_user_id, null);
});

Deno.test("a null token column never matches, nor does a non-uuid token", async () => {
  assertEquals((await decideTransferAccess(complete(OTHER_T, { access_token: "" }), user(null), load)).ok, false);
  assertEquals((await decideTransferAccess(complete(OTHER_T, { access_token: "null" }), user(null), load)).ok, false);
  const noFrom = { ...ROWS[OTHER_T], from_user_id: null };
  assertEquals((await decideTransferAccess(complete(OTHER_T), user(null), () => Promise.resolve(noFrom))).ok, false);
});

Deno.test("ingest_email and ingest_sms are the service key or an admin only, even for a party", async () => {
  for (const action of ["ingest_email", "ingest_sms"]) {
    assertEquals((await decideTransferAccess({ action, transfer_id: T }, user(SELLER), load)).ok, false);
    assertEquals((await decideTransferAccess({ action, transfer_id: T, access_token: BUYER_TOKEN }, user(null), load)).ok, false);
    assertEquals((await decideTransferAccess({ action, transfer_id: T }, { privileged: true, userId: null }, load)).ok, true);
  }
});

Deno.test("an unknown or malformed transfer gets the same refusal as someone else's", async () => {
  const unknown = await decideTransferAccess(complete("33333333-3333-4333-8333-333333333333"), user(SELLER), load);
  const notMine = await decideTransferAccess(complete(OTHER_T), user(SELLER), load);
  assertEquals(unknown, notMine);
  assertEquals((await decideTransferAccess(complete("not-a-uuid"), user(SELLER), load)).ok, false);
  assertEquals((await decideTransferAccess({ action: "advance_manual" }, user(SELLER), load)).ok, false);
});

Deno.test("a party loses existing_comm_id; the service key or an admin keeps the body as sent", async () => {
  const a = await decideTransferAccess({ action: "ingest_signal", transfer_id: T, existing_comm_id: "x" }, user(BUYER), load);
  assertEquals("existing_comm_id" in scopeBodyToCaller({ action: "ingest_signal", transfer_id: T, existing_comm_id: "x" }, a), false);
  const p = await decideTransferAccess({ action: "ingest_email", transfer_id: T }, { privileged: true, userId: null }, load);
  const sent = { action: "ingest_signal", transfer_id: T, existing_comm_id: "x", user_id: SELLER };
  assertEquals(scopeBodyToCaller(sent, p), sent);
});

Deno.test("a stored signal never carries the party's access token", () => {
  assertEquals(storableSignalMetadata({ token: BUYER_TOKEN, page: "/t/x" }), { page: "/t/x" });
  assertEquals(storableSignalMetadata({ access_token: BUYER_TOKEN }), {});
  assertEquals(storableSignalMetadata(undefined), null);
});

Deno.test("an admin (TransfersDashboard's JWT) passes on any transfer and is named as itself, not a body value", async () => {
  const ADMIN = "99999999-9999-4999-8999-999999999999";
  const sent = complete(T, { completed_by_user_id: STRANGER, user_id: STRANGER, existing_comm_id: "x" });
  const a = await decideTransferAccess(sent, { privileged: true, userId: ADMIN }, load);
  assertEquals(a, { ok: true, via: "privileged", actingUserId: ADMIN });
  const body = scopeBodyToCaller(sent, a);
  assertEquals([body.completed_by_user_id, body.user_id, body.existing_comm_id], [ADMIN, ADMIN, "x"]);
});
