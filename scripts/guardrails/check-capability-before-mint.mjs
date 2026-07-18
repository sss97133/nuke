#!/usr/bin/env node
/**
 * check-capability-before-mint.mjs — the anti-"mint new" preflight.
 *
 * Usage:
 *   node scripts/guardrails/check-capability-before-mint.mjs "<name-or-capability>"
 *   node scripts/guardrails/check-capability-before-mint.mjs --test   # self-test against ledger
 *   node scripts/guardrails/check-capability-before-mint.mjs --json "<name>"  # machine output
 *
 * Reads docs/ledger/ledger.json (assets + capabilities) and docs/ledger/CAPABILITY_MAP.md.
 * If the proposed name/capability already has a CANONICAL owner, prints:
 *   STOP: canonical owner exists -> <name>. Extend it, do not mint.
 * and exits 1. If the name collides with a known DEAD/avoid duplicate, also exits 1
 * (do not resurrect graveyard names). Exits 0 when clear, 2 on usage/data error.
 *
 * Enforces CLAUDE.md invariant #3 ("DON'T MINT") and memory rule
 * feedback_develop_from_what_exists.md. Inert until wired (Wire phase).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const LEDGER_JSON = path.join(REPO_ROOT, 'docs', 'ledger', 'ledger.json');
const CAP_MAP_MD = path.join(REPO_ROOT, 'docs', 'ledger', 'CAPABILITY_MAP.md');

// ---------- text utils ----------
const STOPWORDS = new Set([
  'the', 'a', 'an', 'any', 'for', 'from', 'to', 'of', 'via', 'new', 'and',
  'or', 'with', 'per', 'on', 'in', 'all', 'do', 'x', 'how', 'i', 'my', 'is',
  'edge', 'fn', 'function', 'table', 'script', 'page', 'service', 'system',
  'tool', 'v1', 'v2', 'api',
]);

// domain synonyms: in this repo "scraping" IS the extraction lane
const ALIAS = { scrape: 'extract', scraper: 'extract', scraping: 'extract', scrapes: 'extract' };

function tokenize(s) {
  return String(s)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map((t) => ALIAS[t] ?? t);
}

function slug(s) {
  return tokenize(s).join('-');
}

// prefix-tolerant token match: ingest~ingestion, extract~extraction, valuation~valuations
// light stemmer: generator/generate -> generat, extraction/extractor -> extract,
// wiring/wire -> wir, valuations/valuation -> valu
function stem(t) {
  let s = t;
  if (s.endsWith('s') && s.length - 1 >= 3) s = s.slice(0, -1);
  for (const suf of ['ation', 'ing', 'ion', 'or', 'er', 'ed', 'e']) {
    if (s.endsWith(suf) && s.length - suf.length >= 3) {
      s = s.slice(0, -suf.length);
      break;
    }
  }
  return s;
}

function tokEq(a, b) {
  if (a === b) return true;
  const sa = stem(a);
  const sb = stem(b);
  if (sa === sb) return true;
  const pfx = (x, y) => {
    const [shorter, longer] = x.length <= y.length ? [x, y] : [y, x];
    return shorter.length >= 4 && longer.startsWith(shorter);
  };
  return pfx(a, b) || pfx(sa, sb);
}

function setSubset(sub, sup) {
  return sub.every((t) => sup.some((u) => tokEq(t, u)));
}

// strip parenthetical annotations + markers from ledger name strings:
// "smart-extraction-router (ghost)" -> "smart-extraction-router"
function cleanName(s) {
  return String(s)
    .replace(/\(.*?\)/g, ' ')
    .replace(/[`⚠†✅]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------- load sources ----------
function loadLedger() {
  let raw;
  try {
    raw = readFileSync(LEDGER_JSON, 'utf8');
  } catch (e) {
    die(2, `data error: cannot read ${LEDGER_JSON}: ${e.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    die(2, `data error: ${LEDGER_JSON} is not valid JSON: ${e.message}`);
  }
}

function loadCapMapRows() {
  let raw;
  try {
    raw = readFileSync(CAP_MAP_MD, 'utf8');
  } catch {
    return []; // map is secondary; ledger.json is primary
  }
  const rows = [];
  for (const line of raw.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.trim());
    // "| a | b | c |" -> ['', a, b, c, '']
    if (cells.length < 5) continue;
    const [cap, use, avoid] = [cells[1], cells[2], cells[3]];
    if (!cap || cap.startsWith('---') || cap === 'Capability') continue;
    if (/^\*\*.*\*\*$/.test(cap) && !use) continue; // section header row
    rows.push({ capability: cap, canonical: use, avoid });
  }
  return rows;
}

// ---------- build searchable records ----------
function buildRecords() {
  const ledger = loadLedger();
  const records = []; // {kind, capability, canonical, avoidNames[], source}

  for (const c of ledger.capabilities ?? []) {
    records.push({
      kind: 'capability',
      capability: c.capability,
      canonical: cleanName(c.canonical),
      avoidNames: (c.avoid ?? []).map(cleanName),
      source: 'docs/ledger/ledger.json#capabilities',
    });
  }

  const assets = []; // {name, verdict, subsystem, kind, source}
  for (const a of ledger.assets ?? []) {
    assets.push({
      name: cleanName(a.name),
      verdict: a.verdict,
      subsystem: a.subsystem,
      kind: a.kind,
      source: 'docs/ledger/ledger.json#assets',
    });
  }

  for (const r of loadCapMapRows()) {
    // canonical cell may hold prose; prefer backticked names, fall back to full cell
    const ticked = [...r.canonical.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    const canonical = ticked.length ? ticked.join(' + ') : cleanName(r.canonical);
    const avoidNames = cleanName(r.avoid)
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter((s) => s && s !== '—' && s !== '-');
    records.push({
      kind: 'capability',
      capability: cleanName(r.capability),
      canonical,
      avoidNames,
      source: 'docs/ledger/CAPABILITY_MAP.md',
    });
  }

  return { records, assets };
}

// ---------- matching ----------
function nameHit(queryToks, candidate) {
  const candToks = tokenize(candidate);
  if (candToks.length === 0) return false;
  if (slug(candidate) === queryToks.join('-')) return true;
  // token-set equality (order-insensitive): "bat-listing-sync" == "sync-bat-listing"
  if (setSubset(queryToks, candToks) && setSubset(candToks, queryToks)) return true;
  // strict containment both ways, but only when the smaller side is >=2 tokens
  // (prevents "sync" alone from hitting everything)
  if (queryToks.length >= 2 && setSubset(queryToks, candToks)) return true;
  if (candToks.length >= 2 && setSubset(candToks, queryToks)) return true;
  return false;
}

// role-suffix words describe the SHAPE of a proposed asset, not its capability.
// "vehicle shipping tracker" is still the shipping capability; the unmatched
// "tracker" must not dilute coverage below threshold.
const GENERIC = new Set([
  'tracker', 'manager', 'handler', 'helper', 'orchestrator', 'coordinator',
  'processor', 'engine', 'pipeline', 'worker', 'builder', 'generator',
  'module', 'component', 'wrapper', 'runner', 'checker', 'monitor', 'store',
  'layer', 'utility', 'utils', 'util',
]);

function capabilityScore(queryToks, rec) {
  const recToks = tokenize(`${rec.capability} ${rec.canonical}`);
  const matched = queryToks.filter((t) => recToks.some((u) => tokEq(t, u)));
  if (matched.length === 0) return { rank: 0, core: 0 };
  // precision guard: at least one substantive (len>=4) matched token
  if (!matched.some((t) => t.length >= 4)) return { rank: 0, core: 0 };
  const coreToks = queryToks.filter((t) => !GENERIC.has(t));
  const coreBase = coreToks.length > 0 ? coreToks : queryToks;
  const coreMatched = coreBase.filter((t) => recToks.some((u) => tokEq(t, u)));
  return {
    rank: matched.length / queryToks.length,
    core: coreMatched.length / coreBase.length,
    coreCount: coreBase.length,
  };
}

function check(query) {
  const queryToks = tokenize(query);
  if (queryToks.length === 0) {
    die(2, `usage error: query "${query}" has no substantive tokens`);
  }
  const { records, assets } = buildRecords();
  const result = {
    query,
    verdict: 'CLEAR',
    canonical_owner: null,
    matches: [],
  };

  // 1) exact/near name collision with a ledger ASSET
  for (const a of assets) {
    if (slug(a.name) === queryToks.join('-') || setEq(queryToks, tokenize(a.name))) {
      result.matches.push({
        type: 'asset-name',
        name: a.name,
        verdict: a.verdict,
        subsystem: a.subsystem,
        kind: a.kind,
        source: a.source,
      });
    }
  }

  // 2) name collision with canonical or avoid names inside capability records
  for (const rec of records) {
    const canonNames = rec.canonical.split(/\+| THEN |→| or /i).map((s) => s.trim()).filter(Boolean);
    if (canonNames.some((n) => nameHit(queryToks, n))) {
      result.matches.push({
        type: 'canonical-name',
        capability: rec.capability,
        canonical: rec.canonical,
        source: rec.source,
      });
      continue;
    }
    if (rec.avoidNames.some((n) => nameHit(queryToks, n))) {
      result.matches.push({
        type: 'avoid-name',
        capability: rec.capability,
        canonical: rec.canonical,
        source: rec.source,
      });
    }
  }

  // 3) semantic capability match (always computed; ranked below direct name hits
  //    EXCEPT that a full-coverage capability match outranks an avoid-name hit —
  //    "telegram bot" must resolve to the retired Telegram capability, not to a
  //    graveyard name that happens to contain the word "telegram")
  {
    const scored = records
      .map((rec) => ({ rec, s: capabilityScore(queryToks, rec) }))
      .filter(({ s }) => s.core >= (s.coreCount <= 2 ? 1.0 : 0.75))
      .sort((a, b) => b.s.rank - a.s.rank || b.s.core - a.s.core)
      .slice(0, 3);
    for (const { rec, s } of scored) {
      result.matches.push({
        type: 'capability-match',
        score: Number(s.core.toFixed(2)),
        capability: rec.capability,
        canonical: rec.canonical,
        source: rec.source,
      });
    }
  }

  // ---------- verdict ----------
  const canonAsset = result.matches.find(
    (m) => m.type === 'asset-name' && (m.verdict === 'CANONICAL' || m.verdict === 'LIVE-SECONDARY'),
  );
  const canonName = result.matches.find((m) => m.type === 'canonical-name');
  const capMatch = result.matches.find((m) => m.type === 'capability-match');
  // among avoid-name hits, prefer the one whose CAPABILITY text also overlaps the
  // query — "telegram bot" must cite the retired Telegram capability, not the
  // restoration lane that happens to list telegram-restoration-bot in its graveyard
  const avoidHits = result.matches.filter(
    (m) => m.type === 'avoid-name' || (m.type === 'asset-name' && m.verdict !== 'CANONICAL' && m.verdict !== 'LIVE-SECONDARY'),
  );
  const avoidHit = avoidHits.sort((a, b) => {
    const ov = (m) => {
      const capToks = tokenize(m.capability ?? '');
      return queryToks.filter((t) => capToks.some((u) => tokEq(t, u))).length;
    };
    return ov(b) - ov(a);
  })[0];

  const RETIRED_RX = /\b(RETIRED|DELETED|NONE|DEAD|DON'T)\b/i;
  const pick = (verdict, owner, capability) => {
    result.verdict = verdict;
    result.canonical_owner = owner;
    if (capability) result.matched_capability = capability;
    if (owner && RETIRED_RX.test(owner)) result.verdict = 'STOP-RETIRED';
  };

  if (canonAsset) pick('STOP', canonAsset.name);
  else if (canonName) pick('STOP', canonName.canonical, canonName.capability);
  else if (capMatch && capMatch.score === 1) pick('STOP', capMatch.canonical, capMatch.capability);
  else if (avoidHit) pick('STOP-DEAD-NAME', avoidHit.canonical ?? null, avoidHit.capability);
  else if (capMatch) pick('STOP', capMatch.canonical, capMatch.capability);

  return result;
}

function setEq(a, b) {
  return setSubset(a, b) && setSubset(b, a);
}

// ---------- output ----------
function die(code, msg) {
  console.error(msg);
  process.exit(code);
}

function report(result, asJson) {
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.verdict === 'CLEAR' ? 0 : 1);
  }
  if (result.verdict === 'STOP') {
    console.log(`STOP: canonical owner exists -> ${result.canonical_owner}. Extend it, do not mint.`);
    for (const m of result.matches.slice(0, 4)) {
      if (m.type === 'asset-name') {
        console.log(`  · asset "${m.name}" [${m.verdict}] (${m.subsystem}/${m.kind}) — ${m.source}`);
      } else {
        console.log(`  · capability "${m.capability}" -> ${m.canonical} — ${m.source}`);
      }
    }
    process.exit(1);
  }
  if (result.verdict === 'STOP-RETIRED') {
    console.log(
      `STOP: capability "${result.matched_capability ?? result.query}" is RETIRED/DELETED per the ledger — do not re-mint it.`,
    );
    console.log(`  · ledger ruling: ${result.canonical_owner}`);
    for (const m of result.matches.slice(0, 3)) {
      if (m.capability) console.log(`  · "${m.capability}" — ${m.source}`);
    }
    process.exit(1);
  }
  if (result.verdict === 'STOP-DEAD-NAME') {
    const owner = result.canonical_owner
      ? ` Canonical owner of that capability -> ${result.canonical_owner}. Extend it, do not mint.`
      : ' Check docs/ledger/CANONICAL_LEDGER.md before reusing this name.';
    console.log(`STOP: "${result.query}" is a known DEAD/avoid name in the ledger — do not resurrect it.${owner}`);
    for (const m of result.matches.slice(0, 4)) {
      if (m.type === 'asset-name') {
        console.log(`  · asset "${m.name}" [${m.verdict}] (${m.subsystem}/${m.kind}) — ${m.source}`);
      } else {
        console.log(`  · listed under capability "${m.capability}" — ${m.source}`);
      }
    }
    process.exit(1);
  }
  console.log(`CLEAR: no canonical owner found in the ledger for "${result.query}".`);
  console.log('  Before minting, also confirm against pipeline_registry (computed fields) and TOOLS.md.');
  console.log('  Remember CLAUDE.md invariant #3: a new thing means retiring an old one.');
  process.exit(0);
}

// ---------- self-test ----------
function selfTest() {
  const cases = [
    // [query, expectStop]
    ['sync-bat-listing', true], // known zombie (avoid list)
    ['bat listing extraction', true], // capability -> extract-bat-core
    ['vehicle valuation service', true], // capability -> compute-vehicle-valuation
    ['ingest', true], // canonical asset itself
    ['smart-extraction-router', true], // ghost in avoid list
    ['new sentiment store', true], // comment analysis capability
    ['vin decoder', true], // batch-vin-decode
    ['identity graph builder', true], // NEVER re-mint a graph layer
    ['receipt ocr', true], // receipts capability
    ['telegram bot', true], // retired capability
    ['bat scraper', true], // scraper alias -> BaT extraction lane
    ['wiring bom generator', true], // graveyard name generate-wiring-bom
    ['vehicle shipping tracker', true], // capability RETIRED
    ['quantum flux capacitor calibration', false], // nonsense — must be CLEAR
    ['mustang seat upholstery color picker', false], // not a ledger capability
  ];
  let pass = 0;
  for (const [q, expectStop] of cases) {
    const r = check(q);
    const stopped = r.verdict !== 'CLEAR';
    const ok = stopped === expectStop;
    if (ok) pass++;
    console.log(
      `${ok ? 'PASS' : 'FAIL'}  "${q}" -> ${r.verdict}${r.canonical_owner ? ` (${r.canonical_owner})` : ''}`,
    );
  }
  console.log(`\n${pass}/${cases.length} self-test cases passed`);
  process.exit(pass === cases.length ? 0 : 1);
}

// ---------- main ----------
const args = process.argv.slice(2);
if (args.includes('--test')) selfTest();
const asJson = args.includes('--json');
const query = args.filter((a) => !a.startsWith('--')).join(' ').trim();
if (!query) {
  console.error('usage: node scripts/guardrails/check-capability-before-mint.mjs "<name-or-capability>"');
  console.error('       node scripts/guardrails/check-capability-before-mint.mjs --test');
  process.exit(2);
}
report(check(query), asJson);
