// Synthetic members, pages and items only (shaped like 2006 and 2020s eBay item pages and the Browse getItem body); no captured data.
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  handleHash, honourDeletions, memberHandles, readStoredHandles, redactContact, redactHandles, REDACTED, tombstoneItem, tombstonePage,
} from "./deletedMembers.ts";

const SELLER = "dusty_garage_77", BIDDER = "bidder.one", KEEP = "keeper_seller";
const page2006 = `<html><body><h1>1969 Chevrolet C10</h1>Item number: 1234567890
<div id="ngvi_desc_div"><p>Runs great. Call 775-555-0123 or mail dusty@example.test. Ask for ${SELLER}.</p></div>
Questions and answers about this item
Meet the seller Seller: <a href="http://myworld.ebay.com/${SELLER}">${SELLER}</a> ( <a href="http://feedback.ebay.com/ws/eBayISAPI.dll?ViewFeedback&amp;userid=${SELLER}&amp;ssPageName=x">123</a> ) Feedback: 100% positive
<a href="http://cgi6.ebay.com/ws/eBayISAPI.dll?ViewListedItems&amp;userid=${SELLER}&amp;include=0">See other items</a>
High bidder: ${BIDDER} ( 45 ) Current bid: US $9,000.00 Call eBay at 866-540-3229 for help.
</body></html>`;
const pageModern = `<div class="x-sellercard-atf"><a href="https://www.ebay.com/sch/${SELLER}/m.html?item=117400000001&amp;rt=nc">
<span class="ux-textspans ux-textspans--BOLD">${SELLER}</span></a> (285) 100% positive</div>`;
const item = {
  itemId: "v1|123456789012|0", title: "1969 Chevrolet C10", price: { value: "18500.00", currency: "USD" },
  seller: { username: "Dusty_Garage_77", feedbackScore: 12, feedbackPercentage: "100.0" },
  description: `<p>Call 775-555-0123.</p><a class="eb-post-storelink" href="https://www.ebay.com/usr/${SELLER}">visit</a>`,
};
const lookupOf = async (...gone: string[]) => { const s = new Set(await Promise.all(gone.map(handleHash))); return async () => s; };

Deno.test("the handles a page names, the seller's marked: 2006 labels and links, 2020s seller card, getItem JSON", () => {
  assertEquals([...memberHandles(page2006)].sort(), [[BIDDER, false], [SELLER, true]]);
  assertEquals([...memberHandles(pageModern)], [[SELLER, true]]);
  assertEquals([...memberHandles(JSON.stringify(item))], [[SELLER, true]]);
  assertEquals(memberHandles("no members here (12)").size, 0);
});

Deno.test("the hash is sha256 of the trimmed, lower-cased handle (the SQL ebay_member_sha256)", async () => {
  const h = await handleHash(" ABC ");                            // sha256("abc"), the FIPS 180-2 test vector
  assertEquals([h.length, h.slice(0, 16), h.slice(-8)], [64, "ba7816bf8f01cfea", "f20015ad"]);
  assertEquals(await handleHash("Dusty_Garage_77"), await handleHash(SELLER));
});

Deno.test("a handle is replaced as a token, any case, a sentence's period is not part of it", () => {
  assertEquals(redactHandles(`Ask ${SELLER}. Not ${SELLER}x or x${SELLER}; https://ebay.com/usr/DUSTY_GARAGE_77?a=1 and ${SELLER}.jr stays`, [SELLER]),
    `Ask ${REDACTED}. Not ${SELLER}x or x${SELLER}; https://ebay.com/usr/${REDACTED}?a=1 and ${SELLER}.jr stays`);
  assertEquals(redactHandles("a.b*c-d", ["a.b*c-d"]), REDACTED);   // regex characters in a handle are literal
});

Deno.test("the same text gives the same answer as the SQL contract (text_redact_contact, then ebay_redact_handles)", () => {
  const t = "Selling my truck. Call 775-555-0123 or write deleted_seller_77@example.test. Ask for deleted_seller_77.";
  assertEquals(redactHandles(redactContact(t), ["deleted_seller_77"]),
    "Selling my truck. Call [contact through Nuke] or write [contact through Nuke]. Ask for [deleted eBay user].");
});

Deno.test("a getItem body of a deleted seller: no seller object, no handle anywhere, no contact details; the listing stays", async () => {
  const out = (await tombstoneItem(await lookupOf(SELLER), item)).raw;
  assertEquals(out.seller, {});
  assert(!/dusty_garage_77/i.test(JSON.stringify(out)));
  assertEquals(out.description, `<p>Call [contact through Nuke].</p><a class="eb-post-storelink" href="https://www.ebay.com/usr/${REDACTED}">visit</a>`);
  assertEquals([out.title, out.price.value, out.itemId], [item.title, "18500.00", item.itemId]);
  const kept = await tombstoneItem(await lookupOf(KEEP), item);
  assertEquals(kept, { raw: item, deleted: 0 });                  // nobody on it is deleted: untouched, the same object
});

Deno.test("an archived page of a deleted seller: every mention goes, the description's contact details go, eBay's own text and the bidder stay", async () => {
  const t = await tombstonePage(await lookupOf(SELLER), page2006);
  assertEquals(t.deleted, 1);
  assert(!/dusty_garage_77|775-555-0123|dusty@example/i.test(t.html));
  assert(t.html.includes("Item number: 1234567890") && t.html.includes("866-540-3229") && t.html.includes(`High bidder: ${BIDDER}`));
  assertEquals(t.member, [await handleHash(BIDDER)]);           // the hashes the stored row carries: the deleted seller's is not among them
  assertEquals(t.seller, []);
});

Deno.test("a deleted bidder leaves the page; the seller and the seller's description stay", async () => {
  const t = await tombstonePage(await lookupOf(BIDDER), page2006);
  assert(!t.html.includes(BIDDER) && t.html.includes(`High bidder: ${REDACTED}`));
  assert(t.html.includes(`Seller: <a href="http://myworld.ebay.com/${SELLER}">`) && t.html.includes("775-555-0123"));
  assertEquals(t.seller, [await handleHash(SELLER)]);
});

Deno.test("a page nobody deleted is stored as it came, with its handles' hashes", async () => {
  const t = await tombstonePage(await lookupOf(KEEP), page2006);
  assertEquals(t.html, page2006);
  assertEquals(t.member, [await handleHash(BIDDER), await handleHash(SELLER)].sort());
});

// ---- the worker against a fake database and Storage -------------------------------------------------------------------------

function fakeDb(o: { matchesFirst: any[]; matchesAgain?: any[]; notAssessed?: number; storedPage?: string }) {
  const calls: { fn: string; args: any }[] = [], uploads: Record<string, string> = {};
  let scans = 0;
  const places = ["vehicle_events", "vehicle_observations", "listing_page_snapshots", "external_identities", "ebay_parts_catalog"];
  return {
    calls, uploads,
    rpc: async (fn: string, args: any) => {
      calls.push({ fn, args });
      if (fn === "ebay_deletion_scan") {
        const pass = Math.floor(scans++ / places.length);
        const matches = args.p_place === "vehicle_events" ? (pass === 0 ? o.matchesFirst : (o.matchesAgain ?? [])) : [];
        return { data: { place: args.p_place, scanned: 3, next_after: null, matches, at: "2026-10-20T18:00:00Z",
          not_assessed: args.p_place === "listing_page_snapshots" ? (o.notAssessed ?? 0) : 0 }, error: null };
      }
      if (fn === "ebay_member_spellings") return { data: [SELLER], error: null };
      if (fn === "ebay_listing_storage_snapshots") return { data: [{ id: "s1", listing_key: "100000000002", html_storage_path: "ebay_motors/wayback/2006/x.html" }], error: null };
      if (fn === "mark_ebay_snapshot_redacted") return { data: { ok: true }, error: null };
      if (fn === "redact_ebay_deleted_member") return { data: { ok: true, changed: { vehicle_events: 1, vehicle_observations: 1 }, refused: [] }, error: null };
      if (fn === "finish_ebay_deletions") return { data: { ok: true, finished: true, honoured: 1, no_data: 5 }, error: null };
      if (fn === "ebay_snapshot_handles_todo") return { data: { next_after: null, rows: [{ id: "s9", inline: false, html_storage_path: "p9.html" }] }, error: null };
      if (fn === "set_ebay_snapshot_handles") return { data: { ok: true, updated: args.p_rows.length }, error: null };
      return { data: null, error: { message: `unexpected rpc ${fn}` } };
    },
    storage: { from: () => ({
      download: async (path: string) => ({ data: new Blob([uploads[path] ?? o.storedPage ?? page2006], { type: "text/html" }), error: null }),
      upload: async (path: string, bytes: Uint8Array) => { uploads[path] = new TextDecoder().decode(bytes); return { data: { path }, error: null }; },
    }) },
  };
}

Deno.test("the worker: scan by hash, rewrite the stored page in place, redact the SQL places, check again, finish with counts only", async () => {
  const S = await handleHash(SELLER);
  const db = fakeDb({ matchesFirst: [{ member_sha256: S, listing_key: "100000000002", role: "seller" }] });
  const rep = await honourDeletions(db);
  assert(rep.ok && rep.complete, JSON.stringify(rep.errors));
  assertEquals(rep.changed, { listing_page_snapshots_stored: 1, vehicle_events: 1, vehicle_observations: 1 });
  const page = db.uploads["ebay_motors/wayback/2006/x.html"];
  assert(!/dusty_garage_77|775-555-0123/i.test(page) && page.includes(`High bidder: ${BIDDER}`));
  const red = db.calls.find((c) => c.fn === "redact_ebay_deleted_member")!.args;
  assertEquals([red.p_member_sha256, red.p_seller_keys, red.p_mention_keys, red.p_handles], [S, ["100000000002"], [], [SELLER]]);
  const fin = db.calls.find((c) => c.fn === "finish_ebay_deletions")!.args;
  assertEquals(fin.p_cutoff, "2026-10-20T18:00:00Z");             // the database's clock at the first page, not the worker's
  assertEquals(fin.p_results, [{ member_sha256: S, changed: rep.changed, residual: 0, refused: 0 }]);
  assertEquals(fin.p_scan.complete, true);
  assert(!/dusty_garage|bidder\.one/i.test(JSON.stringify(rep)));  // the report names no member
  assertEquals(db.calls.filter((c) => c.fn === "ebay_deletion_scan").length, 10);   // the residual scan ran
});

Deno.test("a member still found after redaction is reported residual, not honoured", async () => {
  const S = await handleHash(SELLER), m = [{ member_sha256: S, listing_key: "100000000002", role: "seller" }];
  const rep = await honourDeletions(fakeDb({ matchesFirst: m, matchesAgain: m }));
  assertEquals(rep.residual_members, 1);
});

Deno.test("out of time: no status changes", async () => {
  const db = fakeDb({ matchesFirst: [] });
  const rep = await honourDeletions(db, { budgetMs: -1 });
  assertEquals(rep.complete, false);
  assert(!db.calls.some((c) => c.fn === "finish_ebay_deletions"));
});

Deno.test("a dry run scans and changes nothing", async () => {
  const db = fakeDb({ matchesFirst: [{ member_sha256: await handleHash(SELLER), listing_key: "100000000002", role: "seller" }] });
  const rep = await honourDeletions(db, { dryRun: true });
  assertEquals([rep.members_matched, rep.listings_matched], [1, 1]);
  assert(!db.calls.some((c) => /redact|finish|mark/.test(c.fn)) && !Object.keys(db.uploads).length);
});

Deno.test("stored pages are read once for their handles' hashes", async () => {
  const db = fakeDb({ matchesFirst: [] });
  const rep = await readStoredHandles(db);
  assertEquals([rep.pages, rep.written], [1, 1]);
  const row = db.calls.find((c) => c.fn === "set_ebay_snapshot_handles")!.args.p_rows[0];
  assertEquals(row, { snapshot_id: "s9", member_handles_sha256: [await handleHash(BIDDER), await handleHash(SELLER)].sort(), seller_handles_sha256: [await handleHash(SELLER)] });
});
