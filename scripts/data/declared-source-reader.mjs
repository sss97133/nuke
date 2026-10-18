#!/usr/bin/env node
/**
 * scripts/data/declared-source-reader.mjs
 *
 * One reader for public file and API sources declared in the registry, instead of a bespoke extract-* function per
 * source (case ledger 13.9.1, point 5(a)). A source is declared by two rows: observation_sources (slug, trust, the kinds
 * it may write) and its reader row in observation_extractors, whose extractor_config names the format, the URL, the
 * identifier and date fields, the row URL, the filter and the subject. Both rows arrive together when a curator approves
 * an add_source proposal (fn_schema_proposal_apply). Until then the config is read from the open proposal, so a dry run
 * works before approval and a live run is refused by the writer.
 *
 *   dotenvx run -q -- node scripts/data/declared-source-reader.mjs --source sbir-gov-awards \
 *     --file ~/nuke-logs/nsf-awards-20261007/sbir_gov_award_data_2026-10-07.csv --since-year 2015 --phase "Phase I"
 *   dotenvx run -q -- node scripts/data/declared-source-reader.mjs --source nsf-awards-api \
 *     --file ~/nuke-logs/nsf-awards-20261007/nsf_api_fy2008_2025_all_phases.json --since-year 2015 --phase "Phase I"
 *   ... --live --receipts <file.jsonl> [--resume] [--limit N] [--sleep-ms 500] [--stop-file <path>]
 *       [--require-registered] [--subject-org-id <uuid>]
 *
 * WRITE BOUNDARY. It calls ingest-observation only. It never writes vehicle_observations or any other table itself: its
 * database access is read-only SQL inside `begin read only`, and every observation goes through the sanctioned writer.
 * The launchd plist for the NSF run (~/Library/LaunchAgents/ag.nuke.declared-source-nsf.plist) stays unloaded until the
 * owner approves the two add_source proposals (sbir-gov-awards, nsf-awards-api); its runner passes --require-registered.
 *
 * Without --live it only reads: the registry through the Supabase Management API inside `begin read only` (as q.sh and
 * readme-stats.mjs do) and the file. It prints the mapping report and the first payloads. With --live it POSTs one
 * observation per award to the deployed ingest-observation with the service-role bearer, the only write it makes.
 * Every award lands as kind 'activity' with structured_data.kind_detail 'funding_award' on the funder organization.
 * Re-sending an award is safe: the writer returns the stored row as a duplicate (content hash).
 *
 * Needs SUPABASE_ACCESS_TOKEN (registry reads); --live also needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 * Live on a registered source needs the funder organization (the declared id, --subject-org-id, or the one organizations
 * row on the declared website) and refuses to land awards without it. Live on an unregistered source sends one request
 * and stops on the writer's answer; with --require-registered it sends nothing (the launchd run uses that).
 * Live stops on: the stop file; any 4xx from the writer (an unregistered source answers "Unknown source"); three 5xx or
 * network failures in a row; ten probes in a row with a REST p50 over 2 s or more than 5 sessions waiting on locks (it
 * pauses 60 s after each; one probe every 25 awards).
 * The NSF API is read from --file when given, else page by page from api.nsf.gov.
 */
import { createHash } from 'node:crypto';
import { appendFileSync, createReadStream, existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';

export const READER_SCRIPT = 'scripts/data/declared-source-reader.mjs';
export const READER_VERSION = 'declared-source-reader@v0';
export const EXTRACTION_METHOD = 'declared_source_reader_v0';
const PROJECT = 'qkgaybvrernstplzjaam';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------------------------------- pure helpers

/** RFC 4180 records from text chunks: quoted fields may hold commas, quotes ("") and line breaks. */
export async function* csvRecords(chunks) {
  let field = '', record = [], quoted = false, pendingQuote = false, sawAny = false;
  for await (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk[i];
      if (pendingQuote) { // a quote inside a quoted field: either "" (a literal quote) or the field's end
        pendingQuote = false;
        if (c === '"') { field += '"'; continue; }
        quoted = false;
      }
      if (quoted) {
        if (c === '"') pendingQuote = true; else field += c;
        continue;
      }
      sawAny = true;
      if (c === '"') quoted = true;
      else if (c === ',') { record.push(field); field = ''; }
      else if (c === '\n') { record.push(field); yield record; record = []; field = ''; sawAny = false; }
      else if (c !== '\r') field += c;
    }
  }
  if (sawAny || field !== '' || record.length > 0) { record.push(field); yield record; }
}

/** MM/DD/YYYY (both sources write US dates) -> YYYY-MM-DD, or null when absent or impossible. */
export function usDate(value) {
  const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/.exec(value ?? '');
  if (!m) return null;
  const [month, day, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return d.toISOString().slice(0, 10);
}

/** The federal fiscal year a date falls in (October 1 starts the next year). */
export const fiscalYear = (isoDay) => Number(isoDay.slice(0, 4)) + (Number(isoDay.slice(5, 7)) >= 10 ? 1 : 0);

const text = (v) => { const s = String(v ?? '').trim(); return s === '' || s === '-' ? null : s; };
const int = (v) => { const s = text(v); return s !== null && /^\d+$/.test(s) ? Number(s) : null; };
const usd = (v) => { const s = text(v)?.replace(/[$,\s]/g, ''); return s && /^\d+(\.\d+)?$/.test(s) ? Number(s) : null; };
const yesNo = (v) => { const s = text(v)?.toUpperCase(); return s === 'Y' ? true : s === 'N' ? false : null; };
const fill = (template, values) => template.replace(/\{([^}]+)\}/g, (_, k) => encodeURIComponent(values[k] ?? ''));
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

/** NSF fundProgramName ("SBIR Phase I, SBIR Outreach & Tech. Assist") -> the SBIR/STTR parts it names. */
export function nsfPrograms(fundProgramName) {
  return String(fundProgramName ?? '').split(',').map((s) => s.trim())
    .map((s) => /^(SBIR|STTR) (Phase I|Phase II|Fast-Track)$/.exec(s)).filter(Boolean)
    .map((m) => ({ program: m[1], phase: m[2] }));
}

const funderAward = (fields) => ({ kind_detail: 'funding_award', relation: 'awarded_to', ...fields });
const envelope = (ctx, { identifier, day, sourceUrl, contentText, structured, rowNumber }) => ({
  source_slug: ctx.slug,
  kind: ctx.config.kind ?? 'activity',
  // Date grain: the source states a day, not a time.
  observed_at: `${day}T00:00:00.000Z`,
  source_url: sourceUrl,
  source_identifier: identifier,
  ...(contentText ? { content_text: contentText } : {}),
  subject: { type: 'organization', ...(ctx.subjectOrgId ? { id: ctx.subjectOrgId } : {}) },
  structured_data: structured,
  ...(ctx.extractorId ? { extractor_id: ctx.extractorId } : {}),
  extraction_method: EXTRACTION_METHOD,
  extraction_metadata: { reader_version: READER_VERSION, source_slug: ctx.slug, mapping: ctx.config.mapping,
    row_number: rowNumber, ...(ctx.fileUrl ? { source_file: ctx.fileUrl } : {}) },
});

/**
 * One SBIR.gov bulk-file row -> { payload } or { skip: reason }. The row's contact names, phones and emails are never
 * copied: they enter only the row hash. Award Year is SBIR.gov's (it matches NSF's fiscal year on 2,841 of 2,904 NSF
 * Phase I awards since 2015 that both sources carry).
 */
export function mapSbirRow(row, rowNumber, ctx) {
  const c = ctx.config;
  for (const [col, want] of Object.entries(c.filter ?? {})) if (row[col] !== want) return { skip: 'filtered' };
  if (ctx.phase && row.Phase !== ctx.phase) return { skip: 'filtered' };
  if (ctx.program && row.Program !== ctx.program) return { skip: 'filtered' };
  const awardYear = int(row['Award Year']);
  if (ctx.sinceYear && !(awardYear >= ctx.sinceYear)) return { skip: 'filtered' };
  const identifier = text(row[c.identifier_column]);
  if (!identifier) return { skip: 'missing_identifier' };
  const day = usDate(row[c.date_column]);
  if (!day) return { skip: text(row[c.date_column]) ? 'bad_date' : 'missing_date' };
  const structured = funderAward({
    funder: text(row.Agency),
    program: text(row.Program),
    phase: text(row.Phase),
    award_year: awardYear,
    award_year_basis: 'sbir_gov_award_year',
    amount_usd: usd(row['Award Amount']),
    amount_basis: 'award_amount',
    start_date: day,
    end_date: usDate(row['Contract End Date']),
    notification_date: usDate(row['Date of Notification']),
    title: text(row['Award Title']),
    contract: text(row.Contract),
    solicitation: text(row['Solicitation Number']),
    awardee: {
      name: text(row.Company), city: text(row.City), state: text(row.State), zip: text(row.Zip),
      duns: text(String(row.Duns ?? '').replace(/'/g, '')), uei: null, website: text(row['Company Website']),
      employees_at_award: int(row['Number Employees']),
      hubzone_owned: yesNo(row['HUBZone Owned']), women_owned: yesNo(row['Women Owned']),
      socially_economically_disadvantaged: yesNo(row['Socially and Economically Disadvantaged']),
    },
    pi: { name: text(row['PI Name']) },
    research_institution: { name: text(row['RI Name']) },
    topic_code: text(row['Topic Code']),
    program_element: null,
    source_row_hash: sha256(JSON.stringify(row)),
  });
  return { payload: envelope(ctx, { identifier, day, rowNumber, structured,
    sourceUrl: fill(c.row_url, row), contentText: text(row.Abstract) }) };
}

/** One NSF awards API record -> { payload } or { skip: reason }. Contact fields (emails, phones) are never copied. */
export function mapNsfAward(award, rowNumber, ctx) {
  const c = ctx.config;
  const parts = nsfPrograms(award.fundProgramName);
  if (parts.length === 0) return { skip: 'filtered' }; // not an SBIR/STTR award (e.g. "Phase I Ctrs for Chem Innovati")
  if (ctx.phase && !parts.some((p) => p.phase === ctx.phase)) return { skip: 'filtered' };
  if (ctx.program && !parts.some((p) => p.program === ctx.program)) return { skip: 'filtered' };
  const identifier = text(award[c.identifier_field]);
  if (!identifier) return { skip: 'missing_identifier' };
  const day = usDate(award[c.date_field]);
  if (!day) return { skip: text(award[c.date_field]) ? 'bad_date' : 'missing_date' };
  const awardYear = fiscalYear(day);
  if (ctx.sinceYear && awardYear < ctx.sinceYear) return { skip: 'filtered' };
  // The row hash covers the fields this mapping asks the API for, so a saved pull and a live read hash alike.
  const record = Object.fromEntries(NSF_FIELDS.split(',').map((f) => [f, award[f] ?? null]));
  const names = [...new Set(parts.map((p) => p.program))], phases = [...new Set(parts.map((p) => p.phase))];
  const structured = funderAward({
    funder: 'National Science Foundation',
    program: names.join('+'),
    phase: phases.join('+'),
    fund_program_name: text(award.fundProgramName),
    award_year: awardYear,
    award_year_basis: 'fiscal_year_of_start_date',
    amount_usd: usd(award.fundsObligatedAmt),
    amount_basis: 'funds_obligated',
    start_date: day,
    end_date: usDate(award.expDate),
    notification_date: usDate(award.date),
    title: text(award.title),
    contract: null,
    solicitation: null,
    awardee: {
      name: text(award.awardeeName), city: text(award.awardeeCity), state: text(award.awardeeStateCode),
      zip: text(award.awardeeZipCode), duns: null, uei: text(award.ueiNumber), website: null, employees_at_award: null,
      hubzone_owned: null, women_owned: null, socially_economically_disadvantaged: null,
    },
    pi: { name: text([award.piFirstName, award.piLastName].filter(Boolean).join(' ')) ?? text(award.pdPIName) },
    research_institution: { name: null },
    topic_code: null,
    program_element: { code: text(award.progEleCode), name: text(award.program) },
    source_row_hash: sha256(JSON.stringify(record)),
  });
  return { payload: envelope(ctx, { identifier, day, rowNumber, structured,
    sourceUrl: fill(c.award_page, award), contentText: text(award.abstractText) }) };
}

/** Walk records through a mapper, counting what happened to each; calls onPayload for each mapped payload. */
export async function mapAll(records, mapper, ctx, onPayload) {
  const report = { rows_read: 0, rows_in_scope: 0, rows_mapped: 0, missing_date: 0, bad_date: 0, missing_identifier: 0,
    duplicate_identifier: 0, by_program_phase: {}, by_award_year: {}, first_observed_at: null, last_observed_at: null };
  const seen = new Set();
  for await (const [record, rowNumber] of records) {
    report.rows_read++;
    const out = mapper(record, rowNumber, ctx);
    if (out.skip === 'filtered') continue;
    report.rows_in_scope++;
    if (out.skip) { report[out.skip]++; continue; }
    const p = out.payload;
    if (seen.has(p.source_identifier)) { report.duplicate_identifier++; continue; }
    seen.add(p.source_identifier);
    report.rows_mapped++;
    const key = `${p.structured_data.program} ${p.structured_data.phase}`;
    report.by_program_phase[key] = (report.by_program_phase[key] ?? 0) + 1;
    report.by_award_year[p.structured_data.award_year] = (report.by_award_year[p.structured_data.award_year] ?? 0) + 1;
    if (!report.first_observed_at || p.observed_at < report.first_observed_at) report.first_observed_at = p.observed_at;
    if (!report.last_observed_at || p.observed_at > report.last_observed_at) report.last_observed_at = p.observed_at;
    if (onPayload && (await onPayload(p)) === false) break;
  }
  return report;
}

// ----------------------------------------------------------------------------------------------------- record sources

async function* csvFileRows(path) {
  let header = null, n = 0;
  for await (const fields of csvRecords(createReadStream(path, { encoding: 'utf8' }))) {
    if (!header) { header = fields.map((h) => h.replace(/^﻿/, '')); continue; }
    n++;
    if (fields.length === 1 && fields[0] === '') continue; // trailing blank line
    yield [Object.fromEntries(header.map((h, i) => [h, fields[i] ?? ''])), n];
  }
}

async function* jsonFileAwards(path) {
  const data = JSON.parse(readFileSync(path, 'utf8'));
  const awards = Array.isArray(data) ? data : data?.response?.award ?? [];
  let n = 0;
  for (const a of awards) yield [a, ++n];
}

const NSF_FIELDS = 'id,title,abstractText,fundsObligatedAmt,awardeeName,awardeeCity,awardeeStateCode,awardeeZipCode,'
  + 'ueiNumber,date,startDate,expDate,fundProgramName,program,progEleCode,piFirstName,piLastName,pdPIName';

/** The NSF awards API, fiscal year by fiscal year from sinceYear, 25 awards a page, a pause between pages. */
async function* nsfApiAwards(config, sinceYear) {
  const thisFy = fiscalYear(new Date().toISOString().slice(0, 10));
  const seen = new Set();
  let n = 0;
  for (let fy = sinceYear ?? 2008; fy <= thisFy; fy++) {
    for (const prog of config.query?.fundProgramName ?? ['SBIR Phase', 'STTR Phase']) {
      for (let offset = 1; ; offset += 25) {
        const qs = new URLSearchParams({ fundProgramName: prog, startDateStart: `10/01/${fy - 1}`,
          startDateEnd: `09/30/${fy}`, printFields: NSF_FIELDS, rpp: '25', offset: String(offset) });
        const res = await fetch(`${config.url}?${qs}`, { signal: AbortSignal.timeout(60000) });
        if (!res.ok) throw new Error(`NSF API ${res.status} at FY${fy} ${prog} offset ${offset}`);
        const page = (await res.json())?.response?.award ?? [];
        for (const a of page) if (!seen.has(a.id)) { seen.add(a.id); yield [a, ++n]; }
        if (page.length < 25) break;
        await sleep(300);
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------- registry (read only)

async function q(sql, attempt = 1) {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error('SUPABASE_ACCESS_TOKEN is not set (run under dotenvx)');
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: `begin read only; set local statement_timeout = '15s'; ${sql}; commit;` }),
  });
  const body = await res.text();
  if ((res.status === 429 || res.status >= 500) && attempt < 4) { await sleep(5000 * attempt); return q(sql, attempt + 1); }
  let rows = null;
  try { rows = JSON.parse(body); } catch { /* reported below */ }
  if (!res.ok || !Array.isArray(rows)) throw new Error(`registry read failed (${res.status}): ${body.slice(0, 200)}`);
  return rows;
}
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** The source's declaration: the registered rows if approved, else the open add_source proposal's payload. */
export async function readDeclaration(slug) {
  const [row] = await q(`
    select s.id as source_id, s.supported_observations, e.id as extractor_id, e.extractor_config
      from observation_sources s
      left join observation_extractors e on e.source_id = s.id and e.extractor_config->>'script' = ${lit(READER_SCRIPT)}
     where s.slug = ${lit(slug)}`);
  if (row) {
    if (!row.extractor_config) throw new Error(`${slug} is registered without a declared reader in observation_extractors`);
    return { registered: true, sourceId: row.source_id, extractorId: row.extractor_id, config: row.extractor_config,
      supported: String(row.supported_observations ?? '').replace(/[{}]/g, '').split(',').filter(Boolean) };
  }
  const [p] = await q(`
    select id, status, payload->'extractor'->'extractor_config' as config from schema_proposals
     where proposal_type = 'add_source' and payload->>'slug' = ${lit(slug)} and status in ('open', 'under_review')
     order by proposed_at desc limit 1`);
  if (!p?.config) throw new Error(`${slug} is neither registered nor proposed with a declared reader`);
  return { registered: false, proposalId: p.id, proposalStatus: p.status, config: p.config, supported: [] };
}

/** The funder organization: the declared id, else the one organizations row on the declared website, else null. */
export async function resolveSubject(config, override) {
  if (override) return { id: override, how: 'flag' };
  if (config.subject_org_id) return { id: config.subject_org_id, how: 'declared' };
  if (!config.subject_org_website) return { id: null, how: 'none declared' };
  const host = new URL(config.subject_org_website).hostname.replace(/^www\./, '');
  const variants = ['https', 'http'].flatMap((s) => [`${s}://${host}`, `${s}://www.${host}`]);
  const rows = await q(`select id from organizations where rtrim(lower(website), '/') in (${variants.map(lit).join(', ')})`);
  if (rows.length > 1) throw new Error(`${rows.length} organizations carry ${host}; pass --subject-org-id`);
  return rows.length ? { id: rows[0].id, how: `organizations.website ${host}` } : { id: null, how: `no organization at ${host}` };
}

// ------------------------------------------------------------------------------------------------------------- live

async function restP50(slug) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/observation_sources?select=id&slug=eq.${encodeURIComponent(slug)}`;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const times = [];
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    try { await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000) }); }
    catch { times.push(15000); continue; }
    times.push(Math.round(performance.now() - t0));
  }
  return times.sort((a, b) => a - b)[1];
}

async function post(payload) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const t0 = performance.now();
  try {
    const res = await fetch(`${process.env.SUPABASE_URL}/functions/v1/ingest-observation`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(30000),
    });
    let body = null;
    const raw = await res.text();
    try { body = JSON.parse(raw); } catch { body = { error: raw.slice(0, 300) }; }
    return { status: res.status, ms: Math.round(performance.now() - t0), body };
  } catch (e) {
    return { status: 0, ms: Math.round(performance.now() - t0), body: { error: e.message } };
  }
}

function args(argv) {
  const a = { show: 2, sleepMs: 500, live: false, resume: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = () => argv[++i];
    if (k === '--source') a.source = v();
    else if (k === '--file') a.file = v().replace(/^~(?=\/)/, homedir());
    else if (k === '--since-year') a.sinceYear = Number(v());
    else if (k === '--phase') a.phase = v();
    else if (k === '--program') a.program = v();
    else if (k === '--limit') a.limit = Number(v());
    else if (k === '--show') a.show = Number(v());
    else if (k === '--sleep-ms') a.sleepMs = Number(v());
    else if (k === '--stop-file') a.stopFile = v().replace(/^~(?=\/)/, homedir());
    else if (k === '--receipts') a.receipts = v().replace(/^~(?=\/)/, homedir());
    else if (k === '--subject-org-id') a.subjectOrgId = v();
    else if (k === '--live') a.live = true;
    else if (k === '--dry-run') a.live = false;
    else if (k === '--resume') a.resume = true;
    else if (k === '--require-registered') a.requireRegistered = true;
    else throw new Error(`unknown flag ${k}`);
  }
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(a.source ?? '')) throw new Error('--source <slug> is required');
  if (a.subjectOrgId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(a.subjectOrgId)) {
    throw new Error('--subject-org-id must be a uuid');
  }
  a.stopFile ??= `${homedir()}/nuke-logs/declared-source-reader.STOP`;
  return a;
}

const log = (...m) => console.log(new Date().toISOString(), ...m);

async function main() {
  const a = args(process.argv.slice(2));
  const decl = await readDeclaration(a.source);
  const config = decl.config;
  const subject = await resolveSubject(config, a.subjectOrgId);
  log(`source ${a.source}: ${decl.registered ? `registered (extractor ${decl.extractorId})`
    : `NOT registered; config from proposal ${decl.proposalId} (${decl.proposalStatus})`}; mapping ${config.mapping}; `
    + `subject ${subject.id ?? 'unresolved'} (${subject.how}); mode ${a.live ? 'LIVE' : 'dry run'}`);

  const mapper = { sbir_gov_award_csv_v0: mapSbirRow, nsf_awards_api_v0: mapNsfAward }[config.mapping];
  if (!mapper) throw new Error(`no mapping ${config.mapping} in ${READER_VERSION}`);
  if (config.format === 'csv' && !a.file) throw new Error('--file <csv> is required for a csv source');
  const records = config.format === 'csv' ? csvFileRows(a.file)
    : a.file ? jsonFileAwards(a.file) : nsfApiAwards(config, a.sinceYear);
  const ctx = { slug: a.source, config, subjectOrgId: subject.id, extractorId: decl.extractorId,
    sinceYear: a.sinceYear, phase: a.phase, program: a.program,
    fileUrl: config.url ? { url: config.url, local_copy: a.file ? a.file.split('/').pop() : null } : null };

  if (!a.live) {
    const shown = [];
    let mapped = 0;
    const report = await mapAll(records, mapper, ctx, (p) => {
      if (shown.length < a.show) shown.push(p);
      return !(a.limit && ++mapped >= a.limit);
    });
    for (const p of shown) {
      console.log(JSON.stringify({ ...p, content_text: p.content_text && `${p.content_text.slice(0, 160)}… (${p.content_text.length} chars)` }, null, 2));
    }
    console.log(JSON.stringify({ mapping_report: report, filters: { since_year: a.sinceYear ?? null, phase: a.phase ?? null,
      program: a.program ?? null }, at: new Date().toISOString() }, null, 2));
    return;
  }

  // ---- live
  for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) if (!process.env[k]) throw new Error(`${k} is not set`);
  if (!decl.registered && a.requireRegistered) {
    throw new Error(`NOT READY: ${a.source} is not registered; proposal ${decl.proposalId} is ${decl.proposalStatus}`);
  }
  if (decl.registered) {
    if (!subject.id) throw new Error('the funder organization is not resolved: create it with create-org-from-url '
      + '(signed in) or pass --subject-org-id; refusing to land awards with no subject');
    if (!decl.supported.includes(config.kind ?? 'activity')) throw new Error(`${a.source} does not support kind ${config.kind}`);
  }
  // Before approval the writer is the authority: one request shows its answer, and the run stops on it.
  const limit = decl.registered ? a.limit : 1;
  if (!decl.registered) log('the source is not registered: sending one request to show the writer\'s answer');
  const done = new Set();
  if (a.resume && a.receipts && existsSync(a.receipts)) {
    for (const line of readFileSync(a.receipts, 'utf8').split('\n')) {
      try { const r = JSON.parse(line); if (r.status === 200) done.add(r.source_identifier); } catch { /* partial line */ }
    }
    log(`resume: ${done.size} awards already answered 200 in ${a.receipts}`);
  }
  const tally = { posted: 0, landed: 0, duplicate: 0, skipped_resume: 0, failed: 0 };
  let fiveXxStreak = 0, pauses = 0, stop = null;
  const report = await mapAll(records, mapper, ctx, async (p) => {
    if (existsSync(a.stopFile)) { stop = `stop file ${a.stopFile}`; return false; }
    if (done.has(p.source_identifier)) { tally.skipped_resume++; return true; }
    if (limit && tally.posted >= limit) return false;
    if (tally.posted % 25 === 0) {
      for (;;) {
        const p50 = await restP50(a.source);
        const [{ waiters }] = await q(`select count(*)::int as waiters from pg_stat_activity where wait_event_type = 'Lock'`);
        if (p50 <= 2000 && waiters <= 5) { pauses = 0; break; }
        if (++pauses >= 10) { stop = `REST p50 ${p50} ms, ${waiters} lock waiters, for 10 probes`; return false; }
        log(`PAUSE rest_p50_ms=${p50} lock_waiters=${waiters} (probe ${pauses}/10), sleeping 60 s`);
        await sleep(60000);
      }
    }
    const r = await post(p);
    tally.posted++;
    const receipt = { at: new Date().toISOString(), source_slug: p.source_slug, source_identifier: p.source_identifier,
      row_number: p.extraction_metadata.row_number, status: r.status, ms: r.ms, observation_id: r.body?.observation_id ?? null,
      duplicate: r.body?.duplicate ?? null, error: r.body?.error ?? null, hint: r.body?.hint ?? null };
    if (a.receipts) appendFileSync(a.receipts, `${JSON.stringify(receipt)}\n`);
    if (r.status === 200 && r.body?.success) {
      fiveXxStreak = 0;
      if (r.body.duplicate) tally.duplicate++; else tally.landed++;
    } else {
      tally.failed++;
      log(`HTTP ${r.status} for ${p.source_identifier}: ${JSON.stringify(r.body).slice(0, 300)}`);
      if (r.status >= 400 && r.status < 500) { stop = `writer refused (${r.status}): ${r.body?.error ?? ''}`; return false; }
      if (++fiveXxStreak >= 3) { stop = 'three 5xx or network failures in a row'; return false; }
    }
    if (tally.posted % 25 === 0) log(`posted=${tally.posted} landed=${tally.landed} duplicate=${tally.duplicate} failed=${tally.failed}`);
    await sleep(a.sleepMs);
    return true;
  });
  log(`END ${stop ? `STOPPED: ${stop}` : 'done'} ${JSON.stringify(tally)} rows_mapped=${report.rows_mapped}`);
  if (stop) process.exitCode = 3;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((e) => { console.error(`declared-source-reader: ${e.message}`); process.exit(2); });
}
