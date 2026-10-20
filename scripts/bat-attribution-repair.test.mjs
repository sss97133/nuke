// node --test scripts/bat-attribution-repair.test.mjs
// Synthetic names and ids only: the repo is public.
import test from "node:test";
import assert from "node:assert/strict";
import { monitorMap, lotAttribution, planRow } from "./bat-attribution-repair.mjs";

const ORG_DEALER = "00000000-0000-0000-0000-0000000000d1";
const ORG_OTHER = "00000000-0000-0000-0000-0000000000d2";
const ID_DEALER = "00000000-0000-0000-0000-00000000a001";
const ID_PRIVATE = "00000000-0000-0000-0000-00000000a002";
const monitors = monitorMap([
  { organization_id: ORG_DEALER, seller_username: "Synthetic_Dealer" },
  { organization_id: ORG_OTHER, seller_username: "synthetic_other" },
  { organization_id: ORG_DEALER, seller_username: "shared_handle" },
  { organization_id: ORG_OTHER, seller_username: "shared_handle" },
]);
const lot = (over = {}) => ({ id: "ae-1", seller_name: "synthetic_private", seller_handle: "synthetic_private",
  seller_external_identity_id: ID_PRIVATE, winning_bidder: "synthetic_buyer", lot_number: "222", outcome: "sold", ...over });
const ev = (over = {}) => ({ id: "ve-1", source_organization_id: ORG_DEALER, seller_external_identity_id: ID_DEALER,
  damage: "wrong_org", ...over });

test("a resale by a private seller: organization cleared, identity set to the lot's own", () => {
  const p = planRow(ev(), [lot()], monitors);
  assert.equal(p.kind, "org_cleared");
  assert.deepEqual(p.row.corrections, {
    source_organization_id: { value: null, expected: ORG_DEALER },
    seller_external_identity_id: { value: ID_PRIVATE, expected: ID_DEALER },
  });
  assert.equal(p.row.source.ref, "auction_events ae-1, repair 2026-10-20");
});

test("a lot sold by another monitored dealer moves to that dealer's organization", () => {
  const p = planRow(ev(), [lot({ seller_name: "synthetic_other", seller_handle: "Synthetic_Other" })], monitors);
  assert.equal(p.kind, "org_to_other_monitored");
  assert.equal(p.row.corrections.source_organization_id.value, ORG_OTHER);
});

test("a handle monitored under two organizations is not guessed: organization null, flagged", () => {
  const a = lotAttribution(lot({ seller_name: "shared_handle", seller_handle: "shared_handle" }), monitors);
  assert.equal(a.org, null);
  assert.equal(a.orgAmbiguous, true);
});

test("no lot row, no seller on the lot row, disagreeing duplicate rows: skipped, never guessed", () => {
  assert.equal(planRow(ev(), [], monitors).skip, "no_lot_row");
  assert.equal(planRow(ev(), [lot({ seller_name: null, seller_handle: null, seller_external_identity_id: null })], monitors).skip,
    "lot_row_has_no_seller");
  assert.equal(planRow(ev(), [lot({ id: "ae-1" }), lot({ id: "ae-2", seller_external_identity_id: ID_DEALER, seller_name: "x", seller_handle: "x" })],
    monitors).skip, "lot_rows_disagree");
});

test("a lot held twice with the same facts is one witness; the lowest id is cited, the other listed", () => {
  const p = planRow(ev(), [lot({ id: "ae-2" }), lot({ id: "ae-1" })], monitors);
  assert.equal(p.row.source.ref, "auction_events ae-1, repair 2026-10-20");
  assert.deepEqual(p.row.source.same_lot_rows, ["ae-2"]);
});

test("a row already correct is not sent", () => {
  const p = planRow(ev({ source_organization_id: null, seller_external_identity_id: ID_PRIVATE }), [lot()], monitors);
  assert.equal(p.skip, "already_correct");
});

test("job B restores seller, buyer and lot number from the lot row and marks the source; images are not touched", () => {
  const p = planRow(ev({ damage: "overwritten_meta" }), [lot()], monitors);
  assert.deepEqual(p.row.corrections.metadata, {
    merge: { seller_username: "synthetic_private", buyer_username: "synthetic_buyer", lot_number: "222", restored_from: "auction_events" },
    restore: true,
  });
  assert.equal(p.kind, "meta_restore+org_cleared");
  assert.ok(!("images" in p.row.corrections.metadata.merge));
});

test("job B: an unsold lot has no buyer key; --no-b-attribution leaves the attribution alone", () => {
  const p = planRow(ev({ damage: "overwritten_meta" }), [lot({ outcome: "reserve_not_met", winning_bidder: "someone" })], monitors,
    { bAttribution: false });
  assert.ok(!("buyer_username" in p.row.corrections.metadata.merge));
  assert.deepEqual(Object.keys(p.row.corrections), ["metadata"]);
});

test("job B does not touch the identity of a row whose organization is right", () => {
  const p = planRow(ev({ damage: "overwritten_meta", source_organization_id: ORG_DEALER, seller_external_identity_id: null }),
    [lot({ seller_name: "synthetic_dealer", seller_handle: "Synthetic_Dealer", seller_external_identity_id: ID_DEALER })], monitors);
  assert.deepEqual(Object.keys(p.row.corrections), ["metadata"]);
  assert.equal(p.kind, "meta_restore");
});
