#!/usr/bin/env node
/** Broadcast discovery: list full-auction replays on the Mecum and Barrett-Jackson YouTube channels and plan
 * rows for broadcast_backfill_queue (the queue scripts/broadcast/worker.mjs claims from).
 *
 *   node scripts/broadcast/discover-streams.mjs                       # dry run: plan file + summary
 *   node scripts/broadcast/discover-streams.mjs --no-enrich --no-db   # titles only, no per-video fetch, no DB reads
 *   dotenvx run -q -f ~/nuke/.env -- node scripts/broadcast/discover-streams.mjs --write [--house mecum] [--limit N]
 *
 * Per channel: yt-dlp flat playlists of /streams and /videos -> classify each video by title and duration
 * (commentated broadcast, all-day livestream, Mecum block cam, or excluded) -> sale name and broadcast date
 * from the title -> optional per-video metadata (cached) for kept videos the title does not date ->
 * auction_events counts per sale (read through scripts/data/q.sh) -> priority.
 * Without --write nothing is written to the database. The plan goes to
 * ~/nuke-logs/broadcast-ingestion/discovery/<date>-streams.json (outside the public repo).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const OUT_ROOT = path.join(os.homedir(), 'nuke-logs', 'broadcast-ingestion', 'discovery');
const RAW_DIR = path.join(OUT_ROOT, 'raw');
const META_DIR = path.join(OUT_ROOT, 'meta');
const MIN_FULL_S = 90 * 60;
const ENRICH_SLEEP_MS = 1000;
const LINKABLE_MIN_EVENTS = 50;

const CHANNELS = {
  mecum: { handle: 'mecum', channelId: 'UCmv1tkDejGDeUKpScvDwkZA' },
  barrett_jackson: { handle: 'BarrettJacksonTV', channelId: 'UC-Q3Jbd5xkDK7cL4cBaXxUg' },
};

const args = process.argv.slice(2);
const flag = name => args.includes(`--${name}`);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const today = new Date().toLocaleDateString('en-CA');
const THIS_YEAR = Number(today.slice(0, 4));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const run = (cmd, argv) => execFileSync(cmd, argv, { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] }).toString();

// ---------- listing ----------

function listSurface(house, surface) {
  const { handle } = CHANNELS[house];
  const file = path.join(RAW_DIR, `${today}-${handle}-${surface}.json`);
  if (!flag('refresh') && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const json = run('yt-dlp', ['--flat-playlist', '-J', '--no-warnings', `https://www.youtube.com/@${handle}/${surface}`]);
  fs.writeFileSync(file, json);
  return JSON.parse(json);
}

function listChannel(house) {
  const videos = new Map();
  const surfaces = {};
  for (const surface of ['streams', 'videos']) {
    const playlist = listSurface(house, surface);
    if (playlist.channel_id !== CHANNELS[house].channelId) {
      throw new Error(`@${CHANNELS[house].handle} resolved to ${playlist.channel_id}, expected ${CHANNELS[house].channelId}`);
    }
    const entries = playlist.entries ?? [];
    surfaces[surface] = entries.length;
    for (const e of entries) {
      const v = videos.get(e.id) ?? { video_id: e.id, title: e.title, duration_seconds: e.duration ? Math.round(e.duration) : null,
        live_status: e.live_status ?? null, surfaces: [] };
      v.live_status ??= e.live_status ?? null;
      v.surfaces.push(surface);
      videos.set(e.id, v);
    }
  }
  return { surfaces, videos: [...videos.values()] };
}

// ---------- classification ----------

const EXCLUDE = [
  ['memorabilia', /\b(road art|automobilia)\b|\broad (mon|tue|wed|thu|fri|sat|sun)/i],
  ['non_auction_program', /\b(preview show|symposium|cup parade|barrett-jackson cup|highlights?|recap|interview|podcast|trailer|teaser|countdown|walk-?around|honors a lifetime)\b/i],
];
const BLOCK_CAM = /\bblock\s*cam\b/i;
const LIVESTREAM = /\b(live\s*stream|livestream|all the cars,? all the time)\b/i;
const BROADCAST = /\b(broadcast|replay|full show|commentated)\b|^live motorcycle auction:.*\bwith\b/i;
const AUCTION_DAY = /\b(collector car auction|motorcycle auction|motorcycles|day\s*\d+|gone farmin)|\bauction\s*-\s*(super\s+)?(mon|tue|wed|thu|fri|sat|sun)/i;

function classify(v) {
  if (v.live_status === 'is_upcoming' || v.live_status === 'is_live') return { kept: false, reason: v.live_status };
  for (const [reason, re] of EXCLUDE) if (re.test(v.title)) return { kept: false, reason };
  if (!v.duration_seconds || v.duration_seconds < MIN_FULL_S) return { kept: false, reason: 'under_90_min' };
  if (BLOCK_CAM.test(v.title)) return { kept: true, kind: 'block_cam' };
  if (LIVESTREAM.test(v.title)) return { kept: true, kind: 'livestream' };
  if (BROADCAST.test(v.title)) return { kept: true, kind: 'broadcast' };
  if (AUCTION_DAY.test(v.title) || v.live_status === 'was_live') return { kept: true, kind: 'livestream' };
  return { kept: false, reason: 'unclassified_long' };
}

// ---------- titles: sale, session, date ----------

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const WEEKDAY_RE = /\b(sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:rs(?:day)?)?|fri(?:day)?|sat(?:urday)?)\b/i;
const MONTH_DATE_RE = /\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?,?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:\s*,?\s*((?:19|20)\d{2}))?/i;
const NUMERIC_DATE_RE = /\b(\d{1,2})\/(\d{1,2})(?:\/((?:19|20)?\d{2}))?\b/;
const YEAR_RE = /\b((?:19|20)\d{2})\b/;

const titleCase = s => s.toLowerCase().replace(/(^|[\s/-])([a-z])/g, (_, p, c) => p + c.toUpperCase()).replace(/'S\b/g, "'s");
const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const utcDate = s => new Date(`${s}T00:00:00Z`);
const addDays = (s, n) => new Date(utcDate(s).getTime() + n * 86400000).toISOString().slice(0, 10);
const weekdayOf = s => utcDate(s).getUTCDay();

function weekdayIn(title) {
  const m = title.match(WEEKDAY_RE);
  if (!m) return null;
  const k = m[1].toLowerCase().slice(0, 3);
  return WEEKDAYS.findIndex(w => w.startsWith(k));
}

function sessionIn(title) {
  const parts = [];
  const sat = title.match(/\bsuper saturday\b|\bbig friday\b/i);
  const day = title.match(/\bday\s*(\d+)\b/i);
  const wd = weekdayIn(title);
  if (sat) parts.push(titleCase(sat[0]));
  else if (wd != null) parts.push(titleCase(WEEKDAYS[wd]));
  if (day) parts.push(`Day ${day[1]}`);
  const part = title.match(/\bpart\s*(\d+)\b/i);
  if (part) parts.push(`Part ${part[1]}`);
  return parts.join(' ') || null;
}

/** Date from the title. A weekday that contradicts the written date moves it to the nearest such weekday. */
function titleDate(title, saleYear) {
  let y, mo, d;
  const m = title.match(MONTH_DATE_RE);
  const n = !m && title.match(NUMERIC_DATE_RE);
  if (m) { mo = MONTHS[m[1].toLowerCase().slice(0, 3)]; d = Number(m[2]); y = m[3] ? Number(m[3]) : saleYear; }
  else if (n) { mo = Number(n[1]); d = Number(n[2]); y = n[3] ? Number(n[3].length === 2 ? `20${n[3]}` : n[3]) : saleYear; }
  if (!mo || !d || !y || mo > 12 || d > 31) return { date: null, basis: null };
  let date = iso(y, mo, d);
  const wd = weekdayIn(title);
  if (wd != null && weekdayOf(date) !== wd) {
    for (const off of [1, -1, 2, -2, 3, -3]) if (weekdayOf(addDays(date, off)) === wd) { date = addDays(date, off); break; }
    return { date, basis: 'title_weekday_corrected' };
  }
  return { date, basis: m?.[3] || n?.[3] ? 'title' : 'title_with_sale_year' };
}

function mecumSale(title) {
  const motorcycle = /\bmotorcycles?\b/i.test(title);
  let t = title
    .replace(/^LIVE Commentated Broadcast \|\s*/i, '')
    .replace(/^Live Motorcycle Auction:\s*/i, '')
    .replace(/^Mecum\s+(Auctions\s+)?/i, '')
    .replace(/^-\s*/, '')
    .replace(/^(Collector Car Auction|Collector Motorcycle Auction|Motorcycle Auction|Motorcycles|Auctions)\s*-?\s*/i, '')
    .replace(/\bKissimme\b/i, 'Kissimmee')
    .replace(/^(Gone Farmin')\s*[-:]\s*/i, '$1 ')
    .trim();
  const lead = t.match(/^((?:19|20)\d{2})\s+(.+)$/);
  if (lead) t = `${lead[2]} ${lead[1]}`;
  const cut = t.search(/\s*(?::|\/\/|\s[-–|]\s|\s-\s?|,|\swith\s|\sLive Block Cam|\sFull Broadcast|\sFull Show|\sReplay|\sDay\s*\d|\sMotorcycle Auction|\sRoad Art)/i);
  let prefix = (cut >= 0 ? t.slice(0, cut) : t).replace(/[\s\-–.]+$/, '').trim();
  if (lead && !YEAR_RE.test(prefix)) prefix = `${prefix} ${lead[1]}`;
  const year = prefix.match(/\s((?:19|20)\d{2})$/)?.[1];
  let place = (year ? prefix.slice(0, -year.length) : prefix).trim().replace(/^Vegas\b/, 'Las Vegas');
  if (!place) return { place: null, year: null };
  if (/^[^a-z]+$/.test(place)) place = titleCase(place);
  if (motorcycle && !/motorcycles/i.test(place)) place = `${place} Motorcycles`;
  return { place, year: year ? Number(year) : null };
}

const BJ_PLACES = /\b(scottsdale fall|scottsdale|palm beach|las vegas|columbus|houston|new orleans|northeast|reno|orange county|petersen)\b/i;

function bjSale(title) {
  const placeMatch = title.match(BJ_PLACES);
  let place = placeMatch ? titleCase(placeMatch[1]) : /\bfall auction\b/i.test(title) ? 'Scottsdale Fall' : null;
  if (place === 'Scottsdale' && /\bfall\b/i.test(title)) place = 'Scottsdale Fall';
  const year = title.match(YEAR_RE)?.[1];
  return { place, year: year ? Number(year) : null };
}

function parseTitle(house, title) {
  const sale = house === 'mecum' ? mecumSale(title) : bjSale(title);
  let { date, basis } = titleDate(title, sale.year);
  if (!sale.year && date) sale.year = Number(date.slice(0, 4));
  if (house === 'barrett_jackson' && !sale.place && date?.slice(5, 7) === '01') sale.place = 'Scottsdale';
  if (house === 'barrett_jackson' && sale.place === 'Scottsdale' && ['10', '11'].includes(date?.slice(5, 7))) sale.place = 'Scottsdale Fall';
  return { place: sale.place, year: sale.year, date, date_basis: basis, session: sessionIn(title), weekday: weekdayIn(title) };
}

/** A weekday-only title takes its date from same-sale siblings when every sibling points to the same day. */
function inferFromSiblings(rows) {
  const bySale = new Map();
  for (const r of rows) if (r.sale && r.broadcast_date) (bySale.get(r.sale) ?? bySale.set(r.sale, []).get(r.sale)).push(r.broadcast_date);
  for (const r of rows) {
    if (r.broadcast_date || r.weekday == null || !bySale.has(r.sale)) continue;
    const candidates = new Set(bySale.get(r.sale).map(d => {
      for (let off = -3; off <= 3; off++) if (weekdayOf(addDays(d, off)) === r.weekday) return addDays(d, off);
      return null;
    }));
    if (candidates.size === 1) { r.broadcast_date = [...candidates][0]; r.date_basis = 'title_weekday_sibling'; }
  }
}

// ---------- per-video metadata (cached, sequential) ----------

async function videoMeta(videoId) {
  const file = path.join(META_DIR, `${videoId}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const j = JSON.parse(run('yt-dlp', ['-J', '--no-warnings', '--skip-download', `https://www.youtube.com/watch?v=${videoId}`]));
  const meta = { video_id: videoId, release_timestamp: j.release_timestamp ?? null, timestamp: j.timestamp ?? null,
    upload_date: j.upload_date ?? null, live_status: j.live_status ?? null, duration: j.duration ?? null, fetched_at: new Date().toISOString() };
  fs.writeFileSync(file, JSON.stringify(meta));
  await sleep(ENRICH_SLEEP_MS);
  return meta;
}

/** Stream start dates the broadcast; an upload time does not, so it only supplies a missing sale year.
 * The stream start is read in UTC-7 so a US daytime start keeps its local date. */
function applyMeta(r, meta) {
  const liveStart = meta.live_status === 'was_live' && meta.release_timestamp;
  if (liveStart) {
    r.broadcast_date ??= new Date((meta.release_timestamp - 7 * 3600) * 1000).toISOString().slice(0, 10);
    r.date_basis ??= 'youtube_stream_start';
  }
  const year = liveStart ? new Date(meta.release_timestamp * 1000).getUTCFullYear()
    : meta.upload_date ? Number(meta.upload_date.slice(0, 4)) : null;
  if (!r.sale_year && year) { r.sale_year = year; r.sale_year_basis = liveStart ? 'youtube_stream_start' : 'youtube_upload_date'; }
}

// ---------- auction_events coverage (reads through scripts/data/q.sh) ----------

function q(sql) {
  const out = run('bash', [path.join(REPO, 'scripts', 'data', 'q.sh'), sql]).trim();
  const rows = JSON.parse(out);
  if (!Array.isArray(rows)) throw new Error(`q.sh: ${out.slice(0, 200)}`);
  return rows;
}

const normName = s => String(s ?? '').toLowerCase().replace(/^mecum\s+/, '').replace(/[^a-z0-9]/g, '');

function loadCoverage() {
  const mecum = new Map();
  for (const r of q("SET statement_timeout = '60s'; SELECT raw_data->>'auction_name' AS sale, count(*)::int AS n FROM auction_events WHERE source = 'mecum' GROUP BY 1")) {
    if (!r.sale) continue;
    const k = normName(r.sale);
    mecum.set(k, (mecum.get(k) ?? 0) + r.n);
  }
  const bj = q("SET statement_timeout = '60s'; SELECT lower(substring(source_url FROM 'barrett-jackson\\.com/([^/]+)/')) AS slug, count(*)::int AS n FROM auction_events WHERE source = 'barrett-jackson' GROUP BY 1")
    .filter(r => r.slug);
  return { mecum, bj };
}

/** Barrett-Jackson sale slugs vary (scottsdale-2025, 2026-scottsdale, scottsdale-march-2021): every word of the
 * place and the year must appear in the slug, and "fall" must appear in both or neither. */
function saleEvents(coverage, house, place, year) {
  if (!coverage || !place || !year) return null;
  if (house === 'mecum') return coverage.mecum.get(normName(`${place} ${year}`)) ?? 0;
  const words = [...place.toLowerCase().split(/\s+/), String(year)];
  const fall = words.includes('fall');
  return coverage.bj.filter(({ slug }) => { const parts = slug.split('-');
    return words.every(w => parts.includes(w)) && parts.includes('fall') === fall; }).reduce((s, r) => s + r.n, 0);
}

// ---------- priority ----------

const KIND_BASE = { broadcast: 40, livestream: 30, block_cam: 10 };
const KIND_SUFFIX = { broadcast: '', livestream: ' Livestream', block_cam: ' Block Cam' };

/** 1-100: kind (commentated broadcast first) + recency + length + whether the sale has lots to link to. */
function priorityOf(r) {
  const year = r.broadcast_date ? Number(r.broadcast_date.slice(0, 4)) : r.sale_year;
  const recency = year ? Math.max(0, 30 - 6 * (THIS_YEAR - year)) : 0;
  const length = Math.min(10, Math.floor((r.duration_seconds ?? 0) / 1800));
  const linkable = r.sale_events >= LINKABLE_MIN_EVENTS ? 20 : 0;
  return Math.max(1, Math.min(100, KIND_BASE[r.kind] + recency + length + linkable));
}

// ---------- queue ----------

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

async function queuedIdsRest() {
  const ids = new Set();
  for (let from = 0; ; from += 1000) {
    const page = await rest('GET', `broadcast_backfill_queue?select=video_id&order=video_id&offset=${from}&limit=1000`);
    for (const r of page) ids.add(r.video_id);
    if (page.length < 1000) return ids;
  }
}

const queueRow = r => ({ video_id: r.video_id, video_url: r.video_url, auction_house: r.auction_house, auction_name: r.auction_name,
  broadcast_date: r.broadcast_date, duration_seconds: r.duration_seconds, status: 'pending', priority: r.priority });

// ---------- main ----------

const hours = rows => Math.round(rows.reduce((s, r) => s + (r.duration_seconds ?? 0), 0) / 360) / 10;
const countBy = (rows, key) => rows.reduce((acc, r) => { acc[r[key]] = (acc[r[key]] ?? 0) + 1; return acc; }, {});

async function main() {
  const write = flag('write');
  const houseFilter = opt('house');
  fs.mkdirSync(RAW_DIR, { recursive: true });
  fs.mkdirSync(META_DIR, { recursive: true });

  let coverage = null, queued = null, queueSource = 'not_read';
  if (!flag('no-db')) {
    try { coverage = loadCoverage(); } catch (e) { console.warn(`coverage not read: ${e.message}`); }
    try { queued = new Set(q('SELECT video_id FROM broadcast_backfill_queue').map(r => r.video_id)); queueSource = 'q.sh'; }
    catch (e) { console.warn(`queue not read: ${e.message}`); }
  }
  if (write) { queued = await queuedIdsRest(); queueSource = 'postgrest'; }

  const channels = {};
  const rows = [];
  const review = [];
  for (const house of Object.keys(CHANNELS)) {
    const { surfaces, videos } = listChannel(house);
    const excluded = {};
    const kept = [];
    for (const v of videos) {
      const c = classify(v);
      if (!c.kept) {
        excluded[c.reason] = (excluded[c.reason] ?? 0) + 1;
        if (c.reason === 'unclassified_long') review.push({ house, video_id: v.video_id, title: v.title, duration_seconds: v.duration_seconds });
        continue;
      }
      const t = parseTitle(house, v.title);
      kept.push({ ...v, auction_house: house, kind: c.kind, place: t.place, sale_year: t.year, sale_year_basis: t.year ? 'title' : null,
        broadcast_date: t.date, date_basis: t.date_basis, session: t.session, weekday: t.weekday });
    }
    channels[house] = { handle: `@${CHANNELS[house].handle}`, channel_id: CHANNELS[house].channelId, surfaces, unique_videos: videos.length, excluded, kept };
  }

  const all = Object.values(channels).flatMap(c => c.kept);
  for (const r of all) r.sale = r.place && r.sale_year ? `${r.place} ${r.sale_year}` : null;
  inferFromSiblings(all);

  const toEnrich = flag('no-enrich') ? [] : all.filter(r => !r.broadcast_date || !r.sale_year);
  const enrichLimit = Number(opt('enrich-limit', Infinity));
  let enriched = 0;
  for (const r of toEnrich.slice(0, enrichLimit)) {
    try { applyMeta(r, await videoMeta(r.video_id)); enriched++; }
    catch (e) { r.meta_error = String(e.message).slice(0, 200); }
    if (enriched % 25 === 0) process.stdout.write(`\r  metadata ${enriched}/${Math.min(toEnrich.length, enrichLimit)}`);
  }
  if (toEnrich.length) process.stdout.write('\n');

  for (const r of all) {
    r.sale = r.place && r.sale_year ? `${r.place} ${r.sale_year}` : r.place;
    r.auction_name = r.sale ? `${r.sale}${KIND_SUFFIX[r.kind]}` : null;
    r.video_url = `https://www.youtube.com/watch?v=${r.video_id}`;
    r.sale_events = saleEvents(coverage, r.auction_house, r.place, r.sale_year);
    r.priority = priorityOf(r);
    r.in_queue = queued ? queued.has(r.video_id) : null;
    delete r.weekday;
  }
  const sameDay = new Map();
  for (const r of all) if (r.broadcast_date) {
    const k = `${r.auction_house}|${r.broadcast_date}|${r.kind}`;
    (sameDay.get(k) ?? sameDay.set(k, []).get(k)).push(r.video_id);
  }
  for (const r of all) {
    const ids = r.broadcast_date ? sameDay.get(`${r.auction_house}|${r.broadcast_date}|${r.kind}`).filter(id => id !== r.video_id) : [];
    r.same_day_same_kind = ids.length ? ids : undefined;
  }
  all.sort((a, b) => b.priority - a.priority || String(b.broadcast_date).localeCompare(String(a.broadcast_date)));

  const summary = {};
  for (const [house, c] of Object.entries(channels)) {
    const kept = c.kept;
    const dates = kept.map(r => r.broadcast_date).filter(Boolean).sort();
    summary[house] = {
      handle: c.handle, channel_id: c.channel_id, surfaces: c.surfaces, unique_videos: c.unique_videos,
      kept: kept.length, kept_hours: hours(kept), by_kind: countBy(kept, 'kind'),
      hours_by_kind: Object.fromEntries(Object.keys(KIND_BASE).map(k => [k, hours(kept.filter(r => r.kind === k))])),
      dated: dates.length, date_range: dates.length ? [dates[0], dates.at(-1)] : null, excluded: c.excluded,
      already_queued: queued ? kept.filter(r => r.in_queue).length : null,
      new_rows: queued ? kept.filter(r => !r.in_queue).length : null,
    };
    for (const r of kept) rows.push(r);
  }

  const sales = {};
  for (const r of rows) {
    const k = `${r.auction_house}:${r.sale ?? '(unknown)'}`;
    sales[k] ??= { auction_house: r.auction_house, sale: r.sale, auction_events: r.sale_events, videos: 0, hours: 0, kinds: {} };
    sales[k].videos++; sales[k].hours += (r.duration_seconds ?? 0) / 3600; sales[k].kinds[r.kind] = (sales[k].kinds[r.kind] ?? 0) + 1;
  }
  for (const s of Object.values(sales)) s.hours = Math.round(s.hours * 10) / 10;

  const plan = {
    generated_at: new Date().toISOString(), method: 'yt-dlp flat playlists of /streams and /videos; title + duration classification',
    min_full_seconds: MIN_FULL_S, enriched_metadata: enriched, queue_read_via: queueSource,
    coverage_note: coverage ? `auction_events per sale: mecum by raw_data.auction_name, barrett-jackson by source_url sale slug; linkable bonus at >= ${LINKABLE_MIN_EVENTS}` : 'not read',
    summary, sales: Object.values(sales).sort((a, b) => (b.auction_events ?? 0) - (a.auction_events ?? 0) || b.videos - a.videos),
    rows: all, review_unclassified_long: review,
  };
  const planPath = path.join(OUT_ROOT, `${today}-streams.json`);
  fs.writeFileSync(planPath, JSON.stringify(plan, null, 2));

  for (const [house, s] of Object.entries(summary)) {
    console.log(`\n${house} ${s.handle}: ${s.unique_videos} videos (streams ${s.surfaces.streams}, videos ${s.surfaces.videos})`);
    console.log(`  kept ${s.kept} (${s.kept_hours} h): ${Object.entries(s.by_kind).map(([k, n]) => `${k} ${n} / ${s.hours_by_kind[k]} h`).join(', ')}`);
    console.log(`  dated ${s.dated}/${s.kept}, range ${s.date_range?.join(' .. ') ?? 'none'}; excluded ${JSON.stringify(s.excluded)}`);
    if (s.new_rows != null) console.log(`  already queued ${s.already_queued}, new ${s.new_rows}`);
  }
  console.log(`\nunclassified long videos for review: ${review.length}`);
  console.log(`plan: ${planPath}`);

  if (!write) return;
  let pending = all.filter(r => !r.in_queue && (!houseFilter || r.auction_house === houseFilter));
  if (opt('limit')) pending = pending.slice(0, Number(opt('limit')));
  let inserted = 0;
  for (let i = 0; i < pending.length; i += 100) {
    const batch = pending.slice(i, i + 100).map(queueRow);
    const res = await rest('POST', 'broadcast_backfill_queue?on_conflict=video_id', batch,
      { Prefer: 'resolution=ignore-duplicates,return=representation' });
    inserted += res?.length ?? 0;
  }
  const receipt = { written_at: new Date().toISOString(), plan: planPath, house: houseFilter ?? 'all', attempted: pending.length, inserted };
  fs.writeFileSync(path.join(OUT_ROOT, `${today}-queue-insert-receipt.json`), JSON.stringify(receipt, null, 2));
  console.log(`queue: inserted ${inserted} of ${pending.length} new rows`);
}

main().catch(e => { console.error(e); process.exit(1); });
