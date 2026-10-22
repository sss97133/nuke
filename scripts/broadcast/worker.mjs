#!/usr/bin/env node
/** Broadcast lot worker: read the lot overlay of an auction livestream, second by second.
 *
 *   dotenvx run -f ~/nuke/.env -- node scripts/broadcast/worker.mjs --video c9fxArnD3IY --publisher mecum
 *   dotenvx run -f ~/nuke/.env -- node scripts/broadcast/worker.mjs --queue --limit 3 --write
 *   dotenvx run -f ~/nuke/.env -- node scripts/broadcast/worker.mjs --status
 *
 * Per video: 360p download -> 1 frame/s of the overlay band -> Apple Vision OCR -> lot presentations
 * (lot, title, displayed bid ladder, status changes) -> scoped match to auction_events (publisher + sale
 * on screen + lot number, no year/make contradiction) -> one youtube media observation per matched
 * presentation through ingest-observation. Without --write nothing is sent; unmatched lots are only
 * reported. Receipts go to ~/nuke-logs/broadcast-ingestion/<video_id>/ (outside the public repo).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { publisherFor } from './publishers.mjs';
import { segmentLots } from './segment-lots.mjs';
import { resolveBroadcastEvent } from '../lib/broadcast-evidence.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PIPELINE = 'broadcast-overlay-ocr-v2';
const LOG_ROOT = path.join(os.homedir(), 'nuke-logs', 'broadcast-ingestion');
const WORK_ROOT = path.join(os.tmpdir(), 'broadcast-work');
const OCR_BIN = path.join(os.homedir(), '.cache', 'nuke-broadcast', 'vision-ocr');
const SAMPLE_S = 1;
const OCR_BATCH = 400;

const args = process.argv.slice(2);
const flag = name => args.includes(`--${name}`);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WORKER_ID = `broadcast-worker-${os.hostname()}-${process.pid}`;

async function rest(method, pathAndQuery, body, extraHeaders = {}) {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required (run under dotenvx)');
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    method,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...extraHeaders },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${pathAndQuery.split('?')[0]} ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function ingest(observation) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/ingest-observation`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(observation),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, ...body };
}

function ensureOcrBinary() {
  const src = path.join(HERE, 'vision-ocr.swift');
  if (fs.existsSync(OCR_BIN) && fs.statSync(OCR_BIN).mtimeMs >= fs.statSync(src).mtimeMs) return;
  fs.mkdirSync(path.dirname(OCR_BIN), { recursive: true });
  execFileSync('swiftc', ['-O', src, '-o', OCR_BIN], { stdio: 'inherit' });
}

const run = (cmd, argv, options = {}) => String(execFileSync(cmd, argv, { maxBuffer: 1 << 28, ...options }) ?? '');

function videoMeta(videoId) {
  const j = JSON.parse(run('yt-dlp', ['-J', '--no-warnings', '--skip-download', `https://www.youtube.com/watch?v=${videoId}`]));
  const ts = j.release_timestamp ?? j.timestamp;
  return {
    video_id: videoId, title: j.title, channel: j.channel, channel_id: j.channel_id, duration_seconds: j.duration,
    was_live: j.was_live ?? j.live_status === 'was_live', live_status: j.live_status ?? null,
    published_at: ts ? new Date(ts * 1000).toISOString() : (j.upload_date ? `${j.upload_date.slice(0, 4)}-${j.upload_date.slice(4, 6)}-${j.upload_date.slice(6, 8)}T00:00:00.000Z` : null),
    published_at_basis: j.release_timestamp ? 'youtube_release_timestamp' : j.timestamp ? 'youtube_upload_timestamp' : 'youtube_upload_date',
  };
}

function downloadVideo(videoId, dir) {
  const out = path.join(dir, 'video.mp4');
  if (fs.existsSync(out)) return out;
  run('yt-dlp', ['-q', '--no-warnings', '-N', '8', '-f', 'bv*[height<=360][vcodec^=avc1]/bv*[height<=360]',
    '-o', out, `https://www.youtube.com/watch?v=${videoId}`], { stdio: ['ignore', 'inherit', 'inherit'] });
  return out;
}

function extractFrames(video, dir, crop) {
  const framesDir = path.join(dir, 'frames');
  if (fs.existsSync(framesDir) && fs.readdirSync(framesDir).length) return framesDir;
  fs.mkdirSync(framesDir, { recursive: true });
  run('ffmpeg', ['-loglevel', 'error', '-i', video, '-vf', `fps=1/${SAMPLE_S},${crop}`, '-q:v', '3',
    path.join(framesDir, 'f_%06d.jpg')]);
  return framesDir;
}

function ocrFrames(framesDir, ocrPath) {
  if (fs.existsSync(ocrPath)) return fs.readFileSync(ocrPath, 'utf8').trim().split('\n').map(JSON.parse);
  const files = fs.readdirSync(framesDir).filter(f => f.endsWith('.jpg')).sort();
  const rows = [];
  for (let i = 0; i < files.length; i += OCR_BATCH) {
    const batch = files.slice(i, i + OCR_BATCH).map(f => path.join(framesDir, f));
    for (const line of run(OCR_BIN, batch).trim().split('\n')) if (line) rows.push(JSON.parse(line));
    process.stdout.write(`\r  ocr ${Math.min(i + OCR_BATCH, files.length)}/${files.length}`);
  }
  process.stdout.write('\n');
  fs.writeFileSync(ocrPath, rows.map(r => JSON.stringify({ ...r, file: path.basename(r.file) })).join('\n') + '\n');
  return rows;
}

const frameSecond = file => (Number(path.basename(file).match(/f_(\d+)/)[1]) - 1) * SAMPLE_S;

const TITLE_YEAR = /^((?:19|20)\d{2})\s+(\S+)/;

/** All vehicle_events of one sale, fetched once per video: metadata->>lot_number has no index, a sale filter does. */
async function saleEpisodes(sale, publisher, cache) {
  const filter = sale && publisher.eventSaleFilter?.(sale);
  if (!filter) return [];
  const key = `episodes:${filter}`;
  if (!cache.has(key)) {
    const platforms = (publisher.eventPlatforms ?? [publisher.auctionSource]).map(encodeURIComponent).join(',');
    const rows = [];
    for (let offset = 0; ; offset += 1000) {
      const page = await rest('GET', `vehicle_events?select=id,vehicle_id,source_url,source_listing_id,event_status,final_price,metadata&source_platform=in.(${platforms})&${filter}&limit=1000&offset=${offset}`);
      rows.push(...page);
      if (page.length < 1000) break;
    }
    cache.set(key, rows.map(e => ({ id: e.id, table: 'vehicle_events', vehicle_id: e.vehicle_id, source: publisher.auctionSource,
      lot_number: e.metadata?.lot_number ?? null, source_url: e.source_url, source_listing_id: e.source_listing_id,
      raw_data: { auction_name: e.metadata?.auction_name ?? null }, winning_bid: e.final_price, outcome: e.event_status })));
  }
  return cache.get(key);
}

async function resolvePresentation(p, publisher, cache) {
  const key = `${publisher.auctionSource}:${p.lot}`;
  if (!cache.has(key)) {
    const events = [];
    for (let offset = 0; ; offset += 1000) {
      const page = await rest('GET', `auction_events?select=id,vehicle_id,source,lot_number,source_url,source_listing_id,raw_data,auction_start_date,winning_bid,outcome&source=eq.${encodeURIComponent(publisher.auctionSource)}&lot_number=eq.${encodeURIComponent(p.lot)}&order=id&limit=1000&offset=${offset}`);
      events.push(...page);
      if (page.length < 1000) break;
    }
    for (const e of await saleEpisodes(p.match_sale, publisher, cache)) if (e.lot_number === p.lot) events.push(e);
    const ids = [...new Set(events.map(e => e.vehicle_id).filter(Boolean))];
    const vehicles = ids.length ? await rest('GET', `vehicles?select=id,year,make,model,vin&id=in.(${ids.join(',')})`) : [];
    const byId = new Map(vehicles.map(v => [v.id, v]));
    cache.set(key, events.map(e => ({ ...e, vehicle: byId.get(e.vehicle_id) ?? {} })));
  }
  // One candidate per vehicle: the same lot held in both event tables is one car, not an ambiguity.
  const perVehicle = new Map();
  for (const e of cache.get(key).filter(e => publisher.saleMatches(p.match_sale, e))) {
    const k = e.vehicle_id ?? e.id;
    if (!perVehicle.has(k) || e.table === 'vehicle_events') perVehicle.set(k, e);
  }
  const scoped = [...perVehicle.values()];
  const [, year, make] = p.title?.match(TITLE_YEAR) ?? [];
  const context = { auction_house: publisher.auctionSource, auction: p.match_sale, lot: p.lot, year: year ? Number(year) : undefined };
  // Make is checked only as a non-contradiction on its first word; model text on screen is abbreviated.
  const result = resolveBroadcastEvent(context, scoped.map(e => ({ ...e,
    raw_data: { ...(e.raw_data ?? {}), auction_name: p.match_sale }, vehicle: { year: e.vehicle.year } })));
  if (result.status === 'scoped_event_match' && make) {
    const event = scoped.find(e => e.id === result.event_id);
    const dbMake = String(event.vehicle.make ?? '').split(/\s+/)[0].toLowerCase();
    if (dbMake && !make.toLowerCase().startsWith(dbMake.slice(0, 4)) && !dbMake.startsWith(make.toLowerCase().slice(0, 4))) {
      return { status: 'rejected', reason: 'make_contradiction', event_id: event.id, db_make: event.vehicle.make, screen_make: make };
    }
    return { ...result, auction_event: { id: event.id, table: event.table ?? 'auction_events', source_url: event.source_url,
      winning_bid: event.winning_bid, outcome: event.outcome } };
  }
  return { ...result, scoped_candidates: scoped.length, lot_candidates: cache.get(key).length };
}

const money = n => n == null ? 'unknown' : `$${n.toLocaleString('en-US')}`;
const hms = s => `${Math.floor(s / 3600)}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

function observationFor(p, resolution, meta, publisherName, capturedAt) {
  const v = meta.video_id;
  return {
    source_slug: 'youtube',
    kind: 'media',
    observed_at: meta.published_at,
    source_url: `https://www.youtube.com/watch?v=${v}&t=${p.start_s}s`,
    source_identifier: `youtube:${v}:lot-presentation:${p.lot}:${p.start_s}:${PIPELINE}`,
    vehicle_id: resolution.vehicle_id,
    content_text: `Broadcast overlay, lot ${p.lot} ${p.title ?? ''} at ${hms(p.start_s)}-${hms(p.end_s)}: displayed bids ${money(p.first_displayed_bid)} to ${money(p.final_displayed_bid)} (${p.bid_ladder.length} changes), outcome shown ${p.displayed_outcome}.`,
    structured_data: {
      property: 'broadcast_lot_presentation',
      kind_detail: 'broadcast_visual_claim',
      claim_role: 'displayed_overlay_sequence',
      unit: 'USD',
      media: { video_id: v, start_seconds: p.start_s, end_seconds: p.end_s, span_semantics: 'overlay_visible_interval',
        sample_interval_seconds: SAMPLE_S, relation: 'screen_display' },
      value: {
        lot: p.lot, title_displayed: p.title, sale_displayed: p.sale,
        bid_ladder: p.bid_ladder, first_displayed_bid: p.first_displayed_bid, final_displayed_bid: p.final_displayed_bid,
        displayed_bid_readings: p.displayed_bid_readings, ask_ladder: p.ask_ladder,
        asks_displayed: p.asks_displayed, status_changes: p.status_changes, reserve_off_at_s: p.reserve_off_at_s,
        displayed_outcome: p.displayed_outcome, overlay_samples: p.overlay_samples, overlay_coverage: p.overlay_coverage,
      },
      event_context: { auction_house: publisherName, auction: p.match_sale, auction_basis: p.match_sale_basis, lot: p.lot,
        matched_event: { table: resolution.auction_event?.table ?? null, id: resolution.event_id }, resolution_status: resolution.status,
        match_method: `house + sale (${p.match_sale_basis}) + exact lot number in vehicle_events/auction_events; year and make must not contradict` },
      interpretation: 'Overlay values sampled once per second. A displayed bid is not an accepted bid, and a displayed SOLD carries no hammer price or fees.',
    },
    extraction_method: PIPELINE,
    raw_source_ref: `youtube:${v}#t=${p.start_s}-${p.end_s}`,
    extraction_metadata: {
      captured_at: capturedAt, pipeline_version: PIPELINE, ocr_engine: 'apple_vision_accurate', frame_height_px: 360,
      source_available_at: meta.published_at, source_available_at_basis: meta.published_at_basis,
      observed_at_semantics: 'video publication time; auction wall clock not established',
      video_title: meta.title, video_was_live: meta.was_live,
    },
    defer_analysis: true,
  };
}

async function processVideo({ videoId, publisherName, write, keep, queueId, saleHint }) {
  const publisher = publisherFor(publisherName);
  const logDir = path.join(LOG_ROOT, videoId);
  const workDir = path.join(WORK_ROOT, videoId);
  fs.mkdirSync(logDir, { recursive: true });
  fs.mkdirSync(workDir, { recursive: true });
  const capturedAt = new Date().toISOString();
  const t0 = Date.now();

  const meta = videoMeta(videoId);
  if (saleHint?.value) meta.sale_hint = saleHint;
  fs.writeFileSync(path.join(logDir, 'meta.json'), JSON.stringify(meta, null, 2));
  console.log(`\n${videoId} [${publisherName}] ${meta.title} (${hms(meta.duration_seconds ?? 0)})`);

  const ocrPath = path.join(logDir, 'ocr.jsonl');
  let framesDir = null;
  if (!fs.existsSync(ocrPath)) {
    console.log('  download 360p'); const video = downloadVideo(videoId, workDir);
    console.log('  frames 1/s'); framesDir = extractFrames(video, workDir, publisher.crop);
  } else console.log('  reusing cached OCR');
  const ocr = ocrFrames(framesDir, ocrPath);

  const readings = ocr.map(r => { const parsed = publisher.parse(r.lines ?? []); return parsed && { t: frameSecond(r.file), ...parsed }; }).filter(Boolean);
  const presentations = segmentLots(readings, { sampleSeconds: SAMPLE_S });
  const metaSale = publisher.saleFromMeta?.(meta) ?? null;
  for (const p of presentations) Object.assign(p, p.sale ? { match_sale: p.sale, match_sale_basis: 'overlay' }
    : { match_sale: metaSale?.sale ?? null, match_sale_basis: metaSale?.basis ?? null });
  console.log(`  sale for matching: ${metaSale ? `${metaSale.sale} (${metaSale.basis}) where the overlay names none` : 'overlay only'}`);
  console.log(`  ${ocr.length} frames, ${readings.length} with overlay, ${presentations.length} lot presentations`);

  const cache = new Map();
  const resolved = [];
  for (const p of presentations) resolved.push({ presentation: p, resolution: await resolvePresentation(p, publisher, cache) });
  const matched = resolved.filter(r => r.resolution.status === 'scoped_event_match' && r.resolution.vehicle_id);
  const unmatched = resolved.filter(r => !matched.includes(r));
  fs.writeFileSync(path.join(logDir, 'presentations.json'), JSON.stringify({ meta, pipeline: PIPELINE, captured_at: capturedAt, resolved }, null, 2));
  console.log(`  matched ${matched.length}/${presentations.length} to auction_events; ${unmatched.length} unmatched (see presentations.json)`);

  const receipt = { video_id: videoId, publisher: publisherName, write, captured_at: capturedAt, frames: ocr.length,
    overlay_frames: readings.length, presentations: presentations.length, matched: matched.length, unmatched: unmatched.length,
    sold_displayed: presentations.filter(p => p.displayed_outcome === 'sold').length, results: [] };
  if (write) {
    if (!meta.published_at) throw new Error('publication time unknown; refusing to write observations without a stable observed_at');
    for (const { presentation, resolution } of matched) {
      const r = await ingest(observationFor(presentation, resolution, meta, publisherName, capturedAt));
      receipt.results.push({ lot: presentation.lot, start_s: presentation.start_s, status: r.status, observation_id: r.observation_id ?? null,
        duplicate: r.duplicate ?? false, error: r.error ?? null });
    }
    const failed = receipt.results.filter(r => r.status >= 400);
    console.log(`  ingested ${receipt.results.length - failed.length}, failed ${failed.length}`);
    if (failed.length) console.log(`  first failure: ${JSON.stringify(failed[0])}`);
  }
  receipt.elapsed_s = Math.round((Date.now() - t0) / 1000);
  fs.writeFileSync(path.join(logDir, write ? 'ingest-receipt.json' : 'dry-run-receipt.json'), JSON.stringify(receipt, null, 2));
  if (!keep) fs.rmSync(workDir, { recursive: true, force: true });

  if (queueId && write) {
    await rest('PATCH', `broadcast_backfill_queue?id=eq.${queueId}`, { status: 'completed', completed_at: new Date().toISOString(),
      lots_extracted: presentations.length, lots_linked: receipt.results.filter(r => r.status < 400).length, error_message: null });
  }
  return receipt;
}

const QUEUE_PUBLISHER = { mecum: 'mecum', barrett_jackson: 'barrett_jackson' };

async function claimNext() {
  const [row] = await rest('GET', 'broadcast_backfill_queue?select=*&status=eq.pending&order=priority.desc.nullslast,broadcast_date.desc.nullslast&limit=1');
  if (!row) return null;
  const claimed = await rest('PATCH', `broadcast_backfill_queue?id=eq.${row.id}&status=eq.pending`,
    { status: 'processing', claimed_by: WORKER_ID, claimed_at: new Date().toISOString(), started_at: new Date().toISOString() },
    { Prefer: 'return=representation' });
  return claimed?.[0] ?? claimNext();
}

async function main() {
  ensureOcrBinary();
  if (flag('status')) {
    const rows = await rest('GET', 'broadcast_backfill_queue?select=auction_house,status,lots_extracted,lots_linked');
    const summary = {};
    for (const r of rows) { const k = `${r.auction_house}:${r.status}`; summary[k] ??= { n: 0, lots: 0, linked: 0 };
      summary[k].n++; summary[k].lots += r.lots_extracted ?? 0; summary[k].linked += r.lots_linked ?? 0; }
    console.table(summary);
    return;
  }
  const write = flag('write'); const keep = flag('keep');
  if (opt('video')) {
    await processVideo({ videoId: opt('video'), publisherName: opt('publisher', 'mecum'), write, keep,
      saleHint: { value: opt('sale'), source: 'cli_sale_option' } });
    return;
  }
  if (flag('queue')) {
    const limit = Number(opt('limit', 1));
    for (let i = 0; i < limit; i++) {
      const row = await claimNext();
      if (!row) { console.log('queue empty'); break; }
      const publisherName = QUEUE_PUBLISHER[row.auction_house];
      try {
        if (!publisherName) throw new Error(`no overlay reader for ${row.auction_house}`);
        await processVideo({ videoId: row.video_id, publisherName, write, keep, queueId: row.id,
          saleHint: { value: row.auction_name, source: 'broadcast_backfill_queue.auction_name' } });
        if (!write) await rest('PATCH', `broadcast_backfill_queue?id=eq.${row.id}`, { status: 'pending', claimed_by: null, claimed_at: null, started_at: null });
      } catch (e) {
        console.error(`  failed: ${e.message}`);
        await rest('PATCH', `broadcast_backfill_queue?id=eq.${row.id}`, { status: 'failed', error_message: String(e.message).slice(0, 500) });
      }
    }
    return;
  }
  console.log('usage: --video <id> [--publisher mecum] [--sale <name>] [--write] [--keep] | --queue [--limit N] [--write] | --status');
}

main().catch(e => { console.error(e); process.exit(1); });
