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

/** Explicit selectors only. Preview or requalify an existing receipt; never admit. */
export async function inspectCabLineage({ sourceId, snapshotId, episodeId, resultId,
  url, key, request = fetch }) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (![sourceId, snapshotId, episodeId, ...(resultId ? [resultId] : [])].every(id => typeof id === 'string' && uuid.test(id))) {
    throw new Error('Expected explicit source observation, snapshot and presentation UUIDs');
  }
  if (!url || !key) throw new Error('Supabase connection unavailable');
  const target = resultId ? '/rest/v1/rpc/qualify_cab_listing_capture' : '/functions/v1/ingest-observation';
  const body = resultId ? { p_source: sourceId, p_snapshot: snapshotId, p_episode: episodeId, p_result: resultId }
    : { mode: 'cab_listing_capture_v1', source_observation_id: sourceId, snapshot_id: snapshotId,
      source_vehicle_event_id: episodeId, dry_run: true };
  const response = await request(`${url.replace(/\/$/, '')}${target}`, {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Listing custody reader unavailable or refused (${response.status})`);
  const data = await response.json();
  const qualified = resultId ? data : data.qualification;
  if (qualified?.ok !== true || qualified.input?.kind !== 'provenance'
    || qualified.input?.structured_data?.listing_capture_receipt?.scope !== 'attributed_listing_narrative_only'
    || (resultId ? qualified.result_verified !== true
    : data.success !== true || data.dry_run !== true || data.writes !== 0)) {
    return { status: 'blocked', reason: qualified?.reason ?? 'qualification_unavailable', public_readiness: 'not_assessed' };
  }
  return { status: resultId ? 'stored_receipt_verified' : 'qualified_not_admitted',
    source_observation_id: sourceId, snapshot_id: snapshotId, vehicle_event_id: episodeId,
    scope: qualified.input?.structured_data?.listing_capture_receipt?.scope,
    receipt_kind: qualified.input.kind,
    source_known_at: qualified.source_known_at, writes: 0, model_calls: 0, public_readiness: 'not_assessed' };
}

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function main() {
  const lineageIndex = process.argv.indexOf('--lineage');
  if (lineageIndex !== -1) {
    const [sourceId, snapshotId, episodeId] = process.argv.slice(lineageIndex + 1, lineageIndex + 4);
    const resultIndex = process.argv.indexOf('--result');
    if (resultIndex !== -1 && !process.argv[resultIndex + 1]) throw new Error('--result requires an existing receipt UUID');
    const result = await inspectCabLineage({ sourceId, snapshotId, episodeId,
      resultId: resultIndex === -1 ? undefined : process.argv[resultIndex + 1],
      url: SUPABASE_URL, key: KEY });
    console.log(JSON.stringify(result, null, 2));
    if (result.status === 'blocked') process.exitCode = 1;
    return;
  }
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
