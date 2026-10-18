#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

/** Source response integrity only: never a database or public-readiness verdict.
 * Counts refer to this response, not the site's historical population. C&B's
 * comment counter has not been reconciled with system/deleted/reply semantics.
 */
export function assessCabCapture({ auctionId, detailRes, commentsRes, limit = 1000 }) {
  const blockers = [];
  const detail = detailRes?.data;
  const rows = commentsRes?.data?.comments_and_bids;
  if (detailRes?.ok !== true) blockers.push('detail_request_failed');
  if (!detail?.listing || String(detail?.id ?? '') !== String(auctionId)) blockers.push('listing_identity_mismatch');
  if (commentsRes?.ok !== true) blockers.push('comments_request_failed');
  if (!Array.isArray(rows)) blockers.push('comments_payload_missing');
  const items = Array.isArray(rows) ? rows : [];
  const ids = new Set();
  let bids = 0;
  for (const row of items) {
    const id = row?.id;
    const validId = (typeof id === 'string' && id.trim().length > 0)
      || (typeof id === 'number' && Number.isSafeInteger(id) && id >= 0);
    if (!validId) blockers.push('source_id_missing');
    else if (ids.has(String(id).trim())) blockers.push('duplicate_source_id');
    else ids.add(String(id).trim());
    // Never let the downstream builder substitute auction close or wall time.
    if (typeof row?.timestamp !== 'string' || !Number.isFinite(Date.parse(row.timestamp))) {
      blockers.push('source_time_missing');
    }
    if (row?.type === 2 || row?.amount) {
      bids++;
      if (!Number.isFinite(Number(row.amount)) || Number(row.amount) <= 0) blockers.push('bid_amount_invalid');
    }
  }
  const claimedBids = detail?.stats?.bids;
  const bidCountKnown = Number.isSafeInteger(claimedBids) && claimedBids >= 0;
  if (bidCountKnown && bids !== claimedBids) blockers.push('bid_count_mismatch');
  // One request with a limit is not an exhaustion proof. Refuse a full page
  // until the owning collector implements and verifies continuation semantics.
  if (items.length >= limit) blockers.push('response_limit_reached');
  return {
    contract: 'cab-capture-integrity-v1',
    auction_id: String(auctionId),
    status: blockers.length ? 'blocked' : 'passed',
    blockers: [...new Set(blockers)],
    received_rows: items.length,
    distinct_source_ids: ids.size,
    received_bids: bids,
    source_reported_bids: bidCountKnown ? claimedBids : null,
    bid_reconciliation: !bidCountKnown ? 'not_assessed' : bids === claimedBids ? 'matched' : 'mismatched',
    source_reported_comments: Number.isSafeInteger(detail?.stats?.comments) && detail.stats.comments >= 0
      ? detail.stats.comments : null,
    comment_reconciliation: 'not_assessed',
    database_reconciliation: 'not_assessed',
    public_readiness: 'not_assessed',
  };
}

export function requireCabCapture(input) {
  const assessment = assessCabCapture(input);
  if (assessment.status === 'blocked') {
    throw new Error(`Cars & Bids capture refused: ${assessment.blockers.join(', ')}`);
  }
  return assessment;
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function main() {
  // Offline inspection of retained cab-v2 JSON; no source fetch or DB writes.
  const fileIndex = process.argv.indexOf('--api-json');
  if (fileIndex !== -1) {
    if (!process.argv[fileIndex + 1]) throw new Error('--api-json requires a retained JSON file');
    const capture = JSON.parse(await readFile(process.argv[fileIndex + 1], 'utf8'));
    const assessment = assessCabCapture({
      auctionId: capture.detail?.id,
      detailRes: { ok: true, data: capture.detail },
      commentsRes: { ok: true, data: capture },
    });
    console.log(JSON.stringify({ ...assessment, transport_verification: 'not_assessed' }, null, 2));
    if (assessment.status === 'blocked') process.exitCode = 1;
    return;
  }
  const res = await fetch(
    SUPABASE_URL + "/storage/v1/object/listing-snapshots/carsandbids/2026/02/27/a357bfd1-edd8-439b-8d81-dc20f78e1474.html",
    { headers: { Authorization: "Bearer " + KEY } }
  );
  const html = await res.text();

  console.log("Title:", html.match(/<title>([^<]+)<\/title>/)?.[1]);
  console.log("HTML length:", html.length);

  // Meta tags
  const metas = html.matchAll(/<meta[^>]*>/gi);
  for (const m of metas) {
    const tag = m[0];
    if (tag.includes("og:") || tag.includes("description")) console.log(tag);
  }

  // __NEXT_DATA__
  const nextData = html.match(/<script id="__NEXT_DATA__"[^>]*>([^<]+)<\/script>/);
  if (nextData) {
    const data = JSON.parse(nextData[1]);
    const pageProps = data?.props?.pageProps;
    if (pageProps) {
      console.log("\npageProps keys:", Object.keys(pageProps));
      // Look for auction/listing data
      const auction = pageProps.auction || pageProps.listing || pageProps.lot;
      if (auction) {
        console.log("\nauction keys:", Object.keys(auction));
        const interesting = {};
        for (const [k, v] of Object.entries(auction)) {
          if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') interesting[k] = v;
        }
        console.log("\nauction fields:", JSON.stringify(interesting, null, 2));
      }
    }
  }

  // Vehicle spec keywords
  for (const kw of ["transmission", "Transmission", "mileage", "Mileage", "VIN", "vin"]) {
    const idx = html.indexOf(kw);
    if (idx > -1) {
      console.log(`\nFound "${kw}" at ${idx}:`, html.substring(Math.max(0, idx-50), idx+100));
    }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('Cars & Bids inspection failed'); process.exitCode = 1; });
}
