/** Read-only listing -> pre-purchase inspection plan (`buying-evidence.mjs --plan`).
 * No intake, inference, pricing decision or writes. See buying-evidence.md, "Listing inspection plan".
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findExcerpts, sourceUrl, validateOptions } from './buying-evidence.mjs';

export const PLAN_CAPTURE_VERSION = 'buying_plan_capture_v1';
export const PLAN_VERSION = 'buying_plan_v1';
export const KEYWORDS_PATH = join(dirname(fileURLToPath(import.meta.url)), 'buying-evidence-plan-keywords.json');
const MAX_TEXT = 32_000, MAX_JSON = 64_000, MAX_PARTS_TERMS = 10;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const vin17 = /^[A-HJ-NPR-Z0-9]{17}$/i;
const SYSTEMS = new Set(['engine_bay', 'top_end', 'bottom_end', 'undercarriage', 'interior', 'wheels', 'drivetrain',
  'cooling', 'electrical', 'fuel', 'ignition', 'suspension', 'brakes', 'body', 'other']);
const OPERATION_KINDS = new Set(['defect_or_condition', 'condition_summary', 'listing_statement']);
const sha = value => createHash('sha256').update(value).digest('hex');
const stamp = () => new Date().toISOString();
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const wrap = sql => `BEGIN READ ONLY; SET LOCAL statement_timeout='5s'; ${sql}; COMMIT;`;
const regex = (source, flags = 'i') => new RegExp(source, flags);
const escapeRe = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const cp = (text, index) => Array.from(text.slice(0, index)).length;
const round = value => Math.round(value * 100) / 100;

export function validateKeywordTable(table) {
  const fail = reason => { throw Error(`Invalid keyword table: ${reason}`); };
  if (!table || table.schema_version !== 'buying_plan_keywords_v1') fail('schema_version');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(table.reviewed_at || '') || typeof table.review_state !== 'string') fail('review fields');
  if (!Array.isArray(table.entries) || !table.entries.length) fail('entries');
  const ids = new Set();
  const stage = row => row && ['category', 'from_stage', 'to_stage', 'zone_pattern']
    .every(k => typeof row[k] === 'string' && /^[a-z_*]{1,40}$/.test(row[k]));
  for (const entry of table.entries) {
    if (!/^[a-z_]{2,40}$/.test(entry.id || '') || ids.has(entry.id)) fail(`entry id ${entry.id}`);
    ids.add(entry.id);
    if (!SYSTEMS.has(entry.system)) fail(`${entry.id} system`);
    for (const key of ['pattern', 'exclude', 'requires']) {
      if (entry[key] === undefined && key !== 'pattern') continue;
      try { regex(entry[key]); } catch { fail(`${entry.id} ${key}`); }
    }
    if (!Array.isArray(entry.targets) || !entry.targets.length) fail(`${entry.id} targets`);
    for (const target of entry.targets) {
      if (target.type === 'labor_operation') { if (!/^[A-Z0-9-]{3,40}$/.test(target.code || '')) fail(`${entry.id} code`); }
      else if (target.type === 'stage_row') { if (!stage(target)) fail(`${entry.id} stage_row`); }
      else if (target.type === 'stage_chain') {
        if (!Array.isArray(target.rows) || target.rows.length < 2 || !target.rows.every(stage)) fail(`${entry.id} stage_chain`);
      } else fail(`${entry.id} target type`);
    }
    if (typeof entry.target_choice !== 'string') fail(`${entry.id} target_choice`);
    if (!Array.isArray(entry.parts_terms) || entry.parts_terms.some(t => !/^[a-z][a-z0-9 -]{2,39}$/.test(t)))
      fail(`${entry.id} parts_terms`);
  }
  for (const [host, sources] of Object.entries(table.listing_image_sources || {}))
    if (!/^[a-z0-9.-]+$/.test(host) || !Array.isArray(sources) || sources.some(s => !/^[a-z_]{2,40}$/.test(s))) fail('listing_image_sources');
  for (const family of table.identity_series_families || [])
    if (!/^[a-z_]{2,40}$/.test(family.family || '') || !Array.isArray(family.tokens) ||
        family.tokens.some(t => !/^[A-Z0-9]{2,10}$/.test(t))) fail('identity_series_families');
  return table;
}

export function loadKeywordTable(path = KEYWORDS_PATH) {
  return validateKeywordTable(JSON.parse(readFileSync(path, 'utf8')));
}

function parentGate(id) {
  return `EXISTS (SELECT 1 FROM public.vehicles p WHERE p.id=${literal(id)}::uuid
    AND p.is_public IS TRUE AND p.deleted_at IS NULL AND p.listing_kind IS DISTINCT FROM 'non_vehicle_item')`;
}

export function modelTokens(model) {
  if (typeof model !== 'string') return [];
  return [...new Set(model.toUpperCase().split(/[^A-Z0-9-]+/).filter(t => /^[A-Z0-9-]{1,20}$/.test(t)))].slice(0, 6);
}

// Every read is one READ ONLY transaction with a finite timeout; child reads repeat the parent gate.
export function planSQL(kind, args = {}) {
  const { id, cutoff, pageSize, after = null } = args;
  const checkId = () => { if (!uuid.test(id || '')) throw Error('Invalid read boundary'); };
  const checkPage = () => {
    if (!Number.isFinite(Date.parse(cutoff)) || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 200 ||
        (after !== null && !uuid.test(after))) throw Error('Invalid read boundary');
  };
  const text = field => `CASE WHEN octet_length(${field})<=${MAX_TEXT} THEN ${field} END`;
  const json = field => `CASE WHEN octet_length(${field}::text)<=${MAX_JSON} THEN ${field} END`;
  if (kind === 'parent') {
    checkId();
    return wrap(`SELECT id,year,make,model,trim,series,vin,engine_size,engine_liters,engine_displacement,displacement,
      engine_type,transmission,drivetrain,fuel_type,mileage,listing_url,bat_auction_url,discovery_url,
      ${text('description')} AS description,octet_length(description) AS description_bytes
      FROM public.vehicles WHERE id=${literal(id)}::uuid AND is_public IS TRUE AND deleted_at IS NULL
      AND listing_kind IS DISTINCT FROM 'non_vehicle_item'`);
  }
  if (kind === 'vin_decode') {
    checkId();
    if (!vin17.test(args.vin || '')) throw Error('Invalid read boundary');
    return wrap(`SELECT vin,make,model,year,trim,engine_size,engine_displacement_liters,engine_cylinders,transmission,
      drivetrain,provider,confidence,decoded_at,raw_response->>'ErrorCode' AS error_code
      FROM public.vin_decoded_data WHERE vin=${literal(args.vin.toUpperCase())} AND ${parentGate(id)}
      ORDER BY decoded_at DESC NULLS LAST LIMIT 2`);
  }
  if (kind === 'discoveries') {
    checkId(); checkPage();
    return wrap(`SELECT id,vehicle_id,discovered_at,model_used,prompt_version,(raw_extraction ? 'error') AS is_failure,
      CASE WHEN NOT (raw_extraction ? 'error') THEN ${json('raw_extraction')} END AS raw_extraction,
      octet_length(raw_extraction::text) AS structured_bytes
      FROM public.description_discoveries WHERE vehicle_id=${literal(id)}::uuid AND ${parentGate(id)}
      AND (discovered_at<=${literal(cutoff)}::timestamptz OR discovered_at IS NULL)
      ${after ? `AND id > ${literal(after)}::uuid` : ''} ORDER BY id LIMIT ${pageSize}`);
  }
  if (kind === 'condition') {
    checkId(); checkPage();
    return wrap(`SELECT o.id,o.vehicle_id,o.source_url,o.observed_at,o.ingested_at,o.extraction_method,o.confidence_score,
      ${text('o.content_text')} AS content_text,octet_length(o.content_text) AS text_bytes,
      ${json('o.structured_data')} AS structured_data,octet_length(o.structured_data::text) AS structured_bytes,
      w.image_id,vi.vehicle_id AS image_vehicle_id,vi.source AS image_source,vi.is_sensitive AS image_is_sensitive
      FROM public.vehicle_observations o
      LEFT JOIN LATERAL (SELECT CASE WHEN x ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN x::uuid END AS image_id FROM (SELECT COALESCE(o.structured_data->>'witness_image_id',
        o.structured_data->>'image_id') AS x) s) w ON true
      LEFT JOIN public.vehicle_images vi ON vi.id=w.image_id
      WHERE o.vehicle_id=${literal(id)}::uuid AND ${parentGate(id)} AND o.subject_type='vehicle'
      AND o.kind::text='condition' AND o.is_superseded IS NOT TRUE AND public.observation_is_public(o.kind,o.structured_data)
      AND (o.ingested_at<=${literal(cutoff)}::timestamptz OR o.ingested_at IS NULL)
      ${after ? `AND o.id > ${literal(after)}::uuid` : ''} ORDER BY o.id LIMIT ${pageSize}`);
  }
  if (kind === 'labor_operations') return wrap(`SELECT code,name,system,base_hours,model_year_min,model_year_max
    FROM public.labor_operations ORDER BY code`);
  if (kind === 'stage_map') return wrap(`SELECT id,category,from_stage,to_stage,zone_pattern,description,
    estimated_hours_min,estimated_hours_typical,estimated_hours_max,materials_cost_min,materials_cost_max,confidence
    FROM public.stage_transition_labor_map ORDER BY id`);
  // No arguments: the contract branch reads the absent work_contracts only when client and organization are both passed.
  if (kind === 'rate') return wrap('SELECT public.resolve_labor_rate() AS rate');
  if (kind === 'parts') {
    checkId();
    const { term, tokens, year } = args;
    if (!/^[a-z][a-z0-9 -]{2,39}$/.test(term || '') || !Array.isArray(tokens) || !tokens.length || tokens.length > 6 ||
        tokens.some(t => !/^[A-Z0-9-]{1,20}$/.test(t)) || !Number.isInteger(year) || year < 1886 || year > 2100)
      throw Error('Invalid read boundary');
    return wrap(`SELECT id,part_number,name,price_current,currency,fits_models,year_start,year_end,manufacturer,category
      FROM public.catalog_parts WHERE ${parentGate(id)} AND price_current>0 AND name ILIKE ${literal(`%${term}%`)}
      AND fits_models IS NOT NULL AND year_start IS NOT NULL AND year_end IS NOT NULL
      AND ${year} BETWEEN year_start AND year_end
      AND EXISTS (SELECT 1 FROM unnest(fits_models) f WHERE upper(f) IN (${tokens.map(literal).join(',')}))
      ORDER BY price_current,id LIMIT 5`);
  }
  throw Error('Unknown plan read');
}

function sentenceAt(text, index) {
  for (const piece of text.matchAll(/[\s\S]+?(?:[.!?]+(?=\s|$)|\n|$)/gu)) {
    if (index >= piece.index && index < piece.index + piece[0].length) {
      const start = cp(text, piece.index);
      return { quote: piece[0], start, end: start + Array.from(piece[0]).length, offset_unit: 'unicode_code_points' };
    }
  }
  return null;
}

function textValues(description, pattern, normalize) {
  if (typeof description !== 'string') return [];
  const out = [];
  for (const match of description.matchAll(regex(pattern, 'gi'))) {
    const value = normalize(match[1] ?? match[0]);
    if (value !== null) out.push({ source: 'listing_text', field_path: 'vehicles.description', raw: match[0], value,
      excerpt: sentenceAt(description, match.index) });
  }
  return out;
}

export function liters(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const s = String(raw);
  let m = s.match(/(\d+(?:\.\d+)?)\s*-?\s*(?:l|liter|litre)s?\b/i);
  if (m) return Math.round(Number(m[1]) * 10) / 10;
  m = s.match(/(\d{3})\s*-?\s*(?:ci|cid|cubic)/i);
  if (m) return Math.round(Number(m[1]) * 0.0163871 * 10) / 10;
  m = s.trim().match(/^(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (n > 0 && n <= 10) return Math.round(n * 10) / 10;
  if (n >= 60 && n < 1000) return Math.round(n * 0.0163871 * 10) / 10;
  if (n >= 1000 && n < 10000) return Math.round(n / 100) / 10;
  return null;
}

const normalizers = {
  year: v => { const n = Number(v); return Number.isInteger(n) && n > 1885 && n < 2101 ? n : null; },
  make: v => typeof v === 'string' && v.trim() ? v.trim().toLowerCase() : null,
  model: v => typeof v === 'string' && v.trim() ? v.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() || null : null,
  vin: v => typeof v === 'string' && /^[A-HJ-NPR-Z0-9]{11,17}$/i.test(v.trim()) ? v.trim().toUpperCase() : null,
  engine_displacement_l: liters,
  transmission: v => typeof v !== 'string' ? null : /manual|stick/i.test(v) ? 'manual' : /auto/i.test(v) ? 'automatic' : null,
  drivetrain: v => typeof v !== 'string' ? null : /4x4|4×4|4wd|four[- ]wheel|4-wheel/i.test(v) ? '4wd'
    : /awd|all[- ]wheel/i.test(v) ? 'awd' : /fwd|front[- ]wheel/i.test(v) ? 'fwd'
      : /rwd|2wd|rear[- ]wheel|4x2/i.test(v) ? '2wd_rwd' : null,
  induction: v => typeof v !== 'string' ? null : /inject|\befi\b|\btbi\b/i.test(v) ? 'fuel_injected'
    : /carb|barrel|quadrajet/i.test(v) ? 'carbureted' : null,
};

function modelRelation(a, b) {
  if (a === b) return 'same';
  const [short, long] = a.split(' ').length <= b.split(' ').length ? [a, b] : [b, a];
  const longTokens = long.split(' ');
  return short.split(' ').every(t => longTokens.some(l => l === t || l.startsWith(t) || t.startsWith(l)))
    ? 'unresolved_specificity' : 'different';
}

function fieldStatus(field, values) {
  if (!values.length) return 'no_source';
  const distinct = [];
  for (const v of values) if (!distinct.some(d => field === 'engine_displacement_l' ? Math.abs(d - v.value) <= 0.1 : d === v.value))
    distinct.push(v.value);
  if (distinct.length > 1) return 'conflict';
  return new Set(values.map(v => v.source)).size > 1 ? 'agree' : 'single_source';
}

// Listing text is compared only through a reviewed series family token; other sources compare whole model labels.
function modelStatus(values, recordToken) {
  if (!values.length) return 'no_source';
  if (values.some(v => v.source === 'listing_text' && v.value !== recordToken)) return 'conflict';
  let status = new Set(values.map(v => v.source)).size > 1 ? 'agree' : 'single_source';
  const distinct = [...new Set(values.filter(v => v.source !== 'listing_text').map(v => v.value))];
  for (let i = 0; i < distinct.length; i++) for (let j = i + 1; j < distinct.length; j++) {
    const relation = modelRelation(distinct[i], distinct[j]);
    if (relation === 'different') return 'conflict';
    if (relation === 'unresolved_specificity') status = 'unresolved_specificity';
  }
  return status;
}

export function buildIdentity(parent, decodeRows, extraction, table) {
  const description = typeof parent.description === 'string' ? parent.description : null;
  const decode = (decodeRows || [])[0] || null;
  const decodeUsable = decode && /^0(?:\D|$)/.test(String(decode.error_code ?? ''));
  const values = Object.fromEntries(Object.keys(normalizers).map(k => [k, []]));
  const add = (field, source, path, raw) => {
    const value = normalizers[field](raw);
    if (value !== null) values[field].push({ source, field_path: path, raw, value });
  };
  for (const [field, columns] of Object.entries({ year: ['year'], make: ['make'], model: ['model'], vin: ['vin'],
    engine_displacement_l: ['engine_liters', 'engine_displacement', 'displacement', 'engine_size'],
    transmission: ['transmission'], drivetrain: ['drivetrain'] }))
    for (const column of columns) add(field, 'record', `vehicles.${column}`, parent[column]);
  if (decodeUsable) for (const [field, column] of [['year', 'year'], ['make', 'make'], ['model', 'model'],
    ['engine_displacement_l', 'engine_displacement_liters'], ['transmission', 'transmission'], ['drivetrain', 'drivetrain']])
    add(field, 'vin_decode', `vin_decoded_data.${column}`, decode[column]);
  if (extraction) {
    const raw = extraction.raw_extraction;
    for (const [field, key] of [['vin', 'vin'], ['engine_displacement_l', 'e_liters'], ['transmission', 't_type'],
      ['drivetrain', 'drive'], ['induction', 'e_fuel']])
      add(field, 'listing_text_extraction', `description_discoveries:${extraction.id}/raw_extraction/${key}`, raw[key]);
    if (values.engine_displacement_l.every(v => v.source !== 'listing_text_extraction') && raw.e_ci != null)
      add('engine_displacement_l', 'listing_text_extraction', `description_discoveries:${extraction.id}/raw_extraction/e_ci`, `${raw.e_ci} ci`);
  }
  const make = normalizers.make(parent.make);
  if (make) values.year.push(...textValues(description, `\\b(1[89]\\d{2}|20\\d{2})\\s+${escapeRe(make)}\\b`, normalizers.year));
  let recordToken = null;
  for (const family of table.identity_series_families || []) {
    const token = family.tokens.find(t => regex(`\\b${t}\\b`).test(parent.model || ''));
    if (!token || recordToken) continue;
    recordToken = token.toLowerCase();
    values.model.push(...textValues(description, `\\b(${family.tokens.join('|')})\\b`, v => v.toLowerCase())
      .map(v => ({ ...v, series_family: family.family })));
  }
  values.vin.push(...textValues(description, '\\b([A-HJ-NPR-Z0-9]{17})\\b', v => /\d/.test(v) && /[A-Z]/i.test(v) ? v.toUpperCase() : null));
  const recordVin = normalizers.vin(parent.vin);
  if (recordVin && recordVin.length < 17 && description) values.vin.push(...textValues(description, `\\b(${escapeRe(recordVin)})\\b`, v => v.toUpperCase()));
  values.engine_displacement_l.push(...textValues(description, '\\b(\\d\\.\\d)[- ]?(?:liter|litre|l)\\b', liters),
    ...textValues(description, '\\b(\\d{3}[- ]?(?:ci|cid|cubic[- ]inch(?:es)?))\\b', liters));
  values.transmission.push(...textValues(description,
    '\\b(?:\\d|three|four|five|six)[- ]speed (manual|automatic)\\b|\\b(manual|automatic) (?:transmission|gearbox)\\b', normalizers.transmission));
  values.drivetrain.push(...textValues(description,
    '\\b(4x4|4×4|4wd|four-wheel drive|2wd|rwd|rear-wheel drive|awd|all-wheel drive)\\b', normalizers.drivetrain));
  values.induction.push(...textValues(description,
    '\\b(carbureted|carburetor|carburettor|[24]-barrel|four-barrel|two-barrel|quadrajet|fuel[- ]injected|fuel injection|efi|tbi|throttle[- ]body injection)\\b',
    normalizers.induction));
  const fields = Object.fromEntries(Object.entries(values).map(([field, list]) =>
    [field, { status: field === 'model' ? modelStatus(list, recordToken) : fieldStatus(field, list), values: list }]));
  return {
    fields,
    conflicts: Object.entries(fields).filter(([, f]) => f.status === 'conflict').map(([k]) => k),
    unresolved_specificity: Object.entries(fields).filter(([, f]) => f.status === 'unresolved_specificity').map(([k]) => k),
    vin_decode: !decode ? { state: recordVin && vin17.test(recordVin) ? 'no_cached_decode' : 'not_applicable_vin_absent_or_not_17' }
      : { state: decodeUsable ? 'usable' : 'error_code_not_success', provider: decode.provider ?? null,
        error_code: decode.error_code ?? null, decoded_at: decode.decoded_at ?? null },
    method: 'deterministic_field_comparison; text values are regex matches with verbatim sentence excerpts; units normalized to liters (ci x 0.0163871)',
    interpretation: 'A conflict means the records disagree. It does not decide which record is right; the inspection does.',
  };
}

function locate(description, text) {
  if (typeof description !== 'string' || typeof text !== 'string' || text.trim().length < 8)
    return { verbatim_excerpt: null, excerpt_status: 'no_exact_excerpt_in_listing_text' };
  const index = description.toLowerCase().indexOf(text.trim().toLowerCase());
  if (index < 0) return { verbatim_excerpt: null, excerpt_status: 'extraction_paraphrase_no_exact_excerpt' };
  const quote = description.slice(index, index + text.trim().length), start = cp(description, index);
  return { verbatim_excerpt: { quote, start, end: start + Array.from(quote).length, offset_unit: 'unicode_code_points' },
    excerpt_status: 'exact_excerpt_in_listing_text' };
}

const V3_KEYS = ['flags', 'work', 'mods', 'docs', 'cond', 'cond_note', 'title', 'miles'];

export function buildClaims(parent, discoveryRows, conditionRows, table) {
  const description = typeof parent.description === 'string' ? parent.description : null;
  const listingUrl = sourceUrl(parent.listing_url || parent.bat_auction_url || parent.discovery_url);
  const listingHost = listingUrl ? new URL(listingUrl).hostname.replace(/^www\./, '') : null;
  const importSources = new Set((table.listing_image_sources || {})[listingHost] || []);
  const claims = [];
  const exclusions = { description_discovery_failure_rows: 0, description_discovery_unrecognized_shape_rows: 0,
    description_discovery_oversized_rows: 0, condition_observations_oversized: 0,
    image_claims_excluded_unattributed: 0, image_claims_excluded_image_row_missing: 0,
    image_claims_excluded_sensitive: 0, image_observations_attributed_without_damage_statement: 0 };
  const push = claim => {
    const id = sha(`${claim.source.ref}\n${claim.source.path}\n${claim.text}`).slice(0, 16);
    if (!claims.some(c => c.claim_id === id)) claims.push({ claim_id: id, ...claim });
  };
  if (description) for (const hit of findExcerpts(description).hits) {
    const facets = hit.facets.map(f => f.name);
    if (!facets.some(f => ['condition', 'unresolved_work'].includes(f))) continue;
    push({ kind: 'listing_statement', text: hit.quote.trim(),
      verbatim_excerpt: { quote: hit.quote, start: hit.start, end: hit.end, offset_unit: hit.offset_unit },
      excerpt_status: 'exact_excerpt_in_listing_text', review_flags: hit.review_flags, facets,
      source: { table: 'vehicles', ref: `vehicles:${parent.id}`, path: '/description', source_url: listingUrl,
        method: 'lexical_candidate', listing_episode: 'current_record_listing_url' },
      clocks: { event_at: null, event_clock_basis: 'listing_publication_clock_not_read', recorded_at: null },
      confidence: { value: null, basis: 'lexical_candidate_unscored' } });
  }
  for (const row of discoveryRows) {
    if (row.is_failure === true) { exclusions.description_discovery_failure_rows++; continue; }
    const raw = row.raw_extraction;
    if (!raw || typeof raw !== 'object') {
      if (row.structured_bytes > MAX_JSON) exclusions.description_discovery_oversized_rows++;
      else exclusions.description_discovery_unrecognized_shape_rows++;
      continue;
    }
    if (!V3_KEYS.some(k => raw[k] !== undefined && raw[k] !== null)) { exclusions.description_discovery_unrecognized_shape_rows++; continue; }
    const base = (path, kind, text, extra = {}) => push({ kind, text, ...locate(description, text), review_flags: [],
      source: { table: 'description_discoveries', ref: `description_discoveries:${row.id}`, path, source_url: listingUrl,
        method: 'llm_extraction_over_listing_text', model: row.model_used ?? null, prompt_version: row.prompt_version ?? null,
        listing_episode: 'vehicle_scoped_not_episode_scoped' },
      clocks: { event_at: null, event_clock_basis: 'listing_publication_clock_not_read', extracted_at: row.discovered_at ?? null },
      confidence: { value: null, basis: 'llm_extraction_unscored',
        extraction_self_reported_auth: typeof raw.auth === 'number' ? raw.auth : null }, ...extra });
    (Array.isArray(raw.flags) ? raw.flags : []).forEach((flag, i) => {
      if (typeof flag?.f === 'string' && flag.f.trim()) base(`/raw_extraction/flags/${i}/f`, 'defect_or_condition', flag.f,
        { extraction_reported_severity: typeof flag.sev === 'string' ? flag.sev : null });
    });
    if (typeof raw.cond_note === 'string' && raw.cond_note.trim()) base('/raw_extraction/cond_note', 'condition_summary', raw.cond_note);
    if (typeof raw.cond === 'string' && raw.cond.trim()) base('/raw_extraction/cond', 'condition_summary', `condition label: ${raw.cond}`);
    (Array.isArray(raw.work) ? raw.work : []).forEach((work, i) => {
      if (typeof work?.w === 'string' && work.w.trim()) base(`/raw_extraction/work/${i}/w`, 'reported_completed_work', work.w,
        { reported_work_date: work.d ?? null, reported_work_by: work.s ?? null });
    });
    (Array.isArray(raw.mods) ? raw.mods : []).forEach((mod, i) => {
      if (typeof mod === 'string' && mod.trim()) base(`/raw_extraction/mods/${i}`, 'modification', mod);
    });
    (Array.isArray(raw.docs) ? raw.docs : []).forEach((doc, i) => {
      if (typeof doc === 'string' && doc.trim()) base(`/raw_extraction/docs/${i}`, 'document_or_title', doc);
    });
    if (typeof raw.title === 'string' && raw.title.trim()) base('/raw_extraction/title', 'document_or_title',
      `title status: ${raw.title}${typeof raw.title_st === 'string' ? ` (${raw.title_st})` : ''}`);
    if (raw.miles !== null && raw.miles !== undefined) base('/raw_extraction/miles', 'odometer',
      `reported mileage: ${raw.miles} ${typeof raw.mi_unit === 'string' ? raw.mi_unit : 'unit unstated'}`);
  }
  for (const row of conditionRows) {
    const data = row.structured_data;
    if ((row.structured_bytes > MAX_JSON && !data) || (row.text_bytes > MAX_TEXT && !row.content_text)) {
      exclusions.condition_observations_oversized++; continue;
    }
    const imageDerived = !!(row.image_id || data?.image_id || data?.witness_image_id ||
      String(data?.analysis_kind || '').startsWith('image'));
    const obs = (path, kind, text, method) => push({ kind, text, ...locate(description, text), review_flags: [],
      source: { table: 'vehicle_observations', ref: `vehicle_observations:${row.id}`, path,
        source_url: row.source_url ?? null, method: method ?? row.extraction_method ?? null,
        listing_episode: !row.source_url ? 'unknown' : sourceUrl(row.source_url) === listingUrl ? 'same_url' : 'different_url',
        ...(imageDerived ? { image_id: row.image_id, image_source: row.image_source } : {}) },
      clocks: { event_at: row.observed_at ?? null, event_clock_basis: 'observation_observed_at', recorded_at: row.ingested_at ?? null },
      confidence: { value: row.confidence_score === null || row.confidence_score === undefined ? null : Number(row.confidence_score),
        basis: 'recorded_observation_confidence_score_unaudited' } });
    if (imageDerived) {
      if (!row.image_id || !row.image_vehicle_id) { exclusions.image_claims_excluded_image_row_missing++; continue; }
      if (row.image_is_sensitive !== false) { exclusions.image_claims_excluded_sensitive++; continue; }
      if (row.image_vehicle_id !== parent.id || !importSources.has(row.image_source)) {
        exclusions.image_claims_excluded_unattributed++; continue;
      }
      const state = data?.state_observations || {};
      const statements = [
        ...(Array.isArray(state.damage_callouts) ? state.damage_callouts : []).map((t, i) => [`/structured_data/state_observations/damage_callouts/${i}`, t]),
        ...(Array.isArray(data?.damage_localized) ? data.damage_localized : []).map((t, i) =>
          [`/structured_data/damage_localized/${i}`, typeof t === 'string' ? t : typeof t?.label === 'string' ? t.label : null]),
        ...(typeof state.rust_severity === 'string' && !/^(none|unknown)$/i.test(state.rust_severity)
          ? [['/structured_data/state_observations/rust_severity', `rust severity: ${state.rust_severity}`]] : []),
      ].filter(([, t]) => typeof t === 'string' && t.trim());
      if (!statements.length) { exclusions.image_observations_attributed_without_damage_statement++; continue; }
      for (const [path, text] of statements) obs(path, 'defect_or_condition', text, `${row.extraction_method ?? 'unknown'}:image_inference_unverified`);
      continue;
    }
    if (data?.rubric) {
      if (typeof data.paint_note === 'string' && data.paint_note.trim()) obs('/structured_data/paint_note', 'defect_or_condition', data.paint_note);
      (Array.isArray(data.known_issues) ? data.known_issues : []).forEach((issue, i) => {
        if (typeof issue === 'string' && issue.trim()) obs(`/structured_data/known_issues/${i}`, 'defect_or_condition', issue);
      });
      if (typeof data.title_flag === 'string' && data.title_flag.trim() && !/^(none|clean)$/i.test(data.title_flag))
        obs('/structured_data/title_flag', 'document_or_title', `title flag: ${data.title_flag}`);
      if (typeof data.emissions_note === 'string' && data.emissions_note.trim()) obs('/structured_data/emissions_note', 'defect_or_condition', data.emissions_note);
    }
    if (typeof row.content_text === 'string' && row.content_text.trim()) obs('/content_text', 'condition_summary', row.content_text);
  }
  return { claims, exclusions };
}

function resolveTarget(target, reference, year) {
  const labor = reference.labor_operations, stages = reference.stage_map;
  const stageKey = row => ({ category: row.category, from_stage: row.from_stage, to_stage: row.to_stage, zone_pattern: row.zone_pattern });
  const findStage = row => stages.rows.find(s => ['category', 'from_stage', 'to_stage', 'zone_pattern'].every(k => s[k] === row[k]));
  const stageLine = (row, found) => ({ key: stageKey(row), stage_map_id: found.id, description: found.description,
    hours: { min: Number(found.estimated_hours_min), typical: Number(found.estimated_hours_typical), max: Number(found.estimated_hours_max) },
    materials: { min: Number(found.materials_cost_min), max: Number(found.materials_cost_max), currency: 'unstated_in_reference' },
    author_declared_confidence: found.confidence ?? null });
  if (target.type === 'labor_operation') {
    if (labor?.state !== 'read') return { type: target.type, code: target.code, state: 'reference_unavailable' };
    const row = labor.rows.find(r => r.code === target.code);
    if (!row) return { type: target.type, code: target.code, state: 'code_absent_from_reference' };
    const min = row.model_year_min, max = row.model_year_max;
    return { type: target.type, code: row.code, name: row.name, system: row.system, state: 'resolved',
      hours: { min: null, typical: Number(row.base_hours), max: null }, range_basis: 'single_book_value_no_range',
      materials: null, method: 'labor_operations.base_hours', label: 'seed_uncalibrated',
      year_applicability: min == null && max == null ? 'unstated' : !Number.isInteger(year) ? 'vehicle_year_unknown'
        : (min == null || year >= min) && (max == null || year <= max) ? 'in_range' : 'out_of_range' };
  }
  if (stages?.state !== 'read') return { type: target.type, state: 'reference_unavailable' };
  if (target.type === 'stage_row') {
    const found = findStage(target);
    return found ? { type: target.type, state: 'resolved', ...stageLine(target, found), range_basis: 'author_declared_min_typical_max',
      method: 'stage_transition_labor_map', label: 'seed_uncalibrated' }
      : { type: target.type, key: stageKey(target), state: 'row_absent_from_reference' };
  }
  const lines = target.rows.map(row => [row, findStage(row)]);
  if (lines.some(([, found]) => !found)) return { type: target.type, state: 'incomplete_chain',
    missing: lines.filter(([, f]) => !f).map(([row]) => stageKey(row)) };
  const rows = lines.map(([row, found]) => stageLine(row, found));
  const sum = pick => round(rows.reduce((n, r) => n + pick(r), 0));
  return { type: target.type, state: 'resolved', rows,
    hours: { min: sum(r => r.hours.min), typical: sum(r => r.hours.typical), max: sum(r => r.hours.max) },
    materials: { min: sum(r => r.materials.min), max: sum(r => r.materials.max), currency: 'unstated_in_reference' },
    range_basis: 'sum_of_author_declared_rows', method: 'sum_of_stage_transition_labor_map_rows', label: 'seed_uncalibrated' };
}

export function matchOperations(claims, table, reference, year) {
  const ops = new Map();
  let excluded = 0;
  for (const claim of claims) {
    if (!OPERATION_KINDS.has(claim.kind)) continue;
    for (const entry of table.entries) {
      if (!regex(entry.pattern).test(claim.text)) continue;
      if (entry.requires && !regex(entry.requires).test(claim.text)) continue;
      if (entry.exclude && regex(entry.exclude).test(claim.text)) { excluded++; continue; }
      if (!ops.has(entry.id)) ops.set(entry.id, { operation_id: `op:${entry.id}`, keyword_entry_id: entry.id,
        system: entry.system, target_choice: entry.target_choice, claim_ids: [], review_flags: new Set(),
        parts_terms: entry.parts_terms, targets: entry.targets.map(t => resolveTarget(t, reference, year)) });
      const op = ops.get(entry.id);
      op.claim_ids.push(claim.claim_id);
      for (const flag of claim.review_flags || []) op.review_flags.add(flag);
      if (/\b(no|not|never|without)\b/i.test(claim.text)) op.review_flags.add('negation_present_review_scope');
      if (claim.kind === 'condition_summary') op.review_flags.add('matched_summary_prose');
    }
  }
  return { operations: [...ops.values()].map(op => ({ ...op, review_flags: [...op.review_flags].sort(),
    stage: 'candidate_for_inspection', basis: 'reviewed_keyword_table_match' })), keyword_matches_excluded_by_rule: excluded };
}

const QUESTIONS = {
  listing_statement: text => `Review this listing statement and inspect what it describes: ${text}`,
  defect_or_condition: text => `Inspect and record whether this holds: ${text}`,
  condition_summary: text => `Assess the stated condition summary against the vehicle: ${text}`,
  reported_completed_work: text => `Verify the reported work (parts present, receipts, workmanship): ${text}`,
  modification: text => `Verify the modification is present and record its installation quality: ${text}`,
  document_or_title: text => `Sight the document or record and note what it shows: ${text}`,
  odometer: text => `Record the odometer reading and check supporting documentation: ${text}`,
};

export function buildChecklist(identity, claims, operations) {
  const systemFor = claimId => operations.find(op => op.claim_ids.includes(claimId))?.system ?? null;
  const items = [];
  for (const [field, info] of Object.entries(identity.fields)) {
    if (!['conflict', 'unresolved_specificity'].includes(info.status)) continue;
    const seen = [...new Set(info.values.map(v => `${v.source}=${v.value}`))].join('; ');
    items.push({ item_id: `ppi:identity:${field}`, order: 0, basis: info.status === 'conflict' ? 'identity_conflict' : 'identity_specificity',
      field, question: `Confirm ${field.replaceAll('_', ' ')} from the VIN plate, build documents and the vehicle itself. Sources: ${seen}`,
      finding: emptyFinding(field === 'engine_displacement_l' || field === 'induction' ? 'engine_bay' : field === 'transmission' || field === 'drivetrain' ? 'drivetrain' : 'other') });
  }
  // Identical text from several projections is one item listing every claim, never extra witnesses.
  const groups = new Map();
  for (const claim of claims) {
    const key = `${claim.kind}\n${claim.text.trim().toLowerCase().replace(/\s+/g, ' ')}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(claim);
  }
  for (const group of groups.values()) {
    const ids = group.map(c => c.claim_id);
    items.push({ item_id: `ppi:${ids[0]}`, order: 1, basis: 'claim', claim_ids: ids, claim_kind: group[0].kind,
      linked_operation_ids: operations.filter(op => op.claim_ids.some(id => ids.includes(id))).map(op => op.operation_id),
      question: QUESTIONS[group[0].kind](group[0].text.trim()), finding: emptyFinding(ids.map(systemFor).find(Boolean)) });
  }
  return items;
}

function emptyFinding(system) {
  return { inspection_type: 'pre_purchase', system: system ?? null, verdict: null, finding: null, severity: null,
    evidence_photo_ref: null, inspector_actor_id: null, observed_at: null };
}

export async function collectPlan(options, query, table) {
  validateOptions({ ...options, query: null });
  validateKeywordTable(table);
  const startedAt = stamp(), deadline = Date.now() + options.seconds * 1000;
  const capture = { schema_version: PLAN_CAPTURE_VERSION, started_at: startedAt, selection_cutoff: startedAt,
    snapshot_semantics: 'separate_current_reads_not_historical_replay', options: { ...options, query: null },
    keyword_table: table, keyword_table_sha256: sha(JSON.stringify(table)), reference: {}, vehicles: [], reads: [] };
  const failures = {};
  const read = async (family, vehicleId, sql) => {
    if ((failures[family] || 0) >= 2) throw Error('repeated_read_failure_stop');
    const start = stamp();
    let rows;
    try { rows = await query(sql, deadline); }
    catch (error) {
      if (error.message !== 'deadline') failures[family] = (failures[family] || 0) + 1;
      throw Error(error.message === 'deadline' ? 'deadline' : 'read_failed');
    }
    failures[family] = 0;
    capture.reads.push({ vehicle_id: vehicleId, family, started_at: start, ended_at: stamp(),
      query_sha256: sha(sql), rows_sha256: sha(JSON.stringify(rows)), returned_rows: rows.length });
    return rows;
  };
  for (const kind of ['labor_operations', 'stage_map', 'rate']) {
    try {
      const rows = await read(kind, null, planSQL(kind));
      capture.reference[kind] = kind === 'rate'
        ? rows.length === 1 && rows[0].rate && typeof rows[0].rate === 'object' ? { state: 'read', value: rows[0].rate } : { state: 'invalid_rate_response' }
        : { state: 'read', rows };
    } catch (error) { capture.reference[kind] = { state: error.message }; }
  }
  const paged = async (family, vehicleId, sqlFor) => {
    const collection = { state: 'partial', pages: 0, rows: [], reason: 'page_budget' };
    let after = null;
    for (let page = 0; page < options.maxPages; page++) {
      let rows;
      try { rows = await read(family, vehicleId, sqlFor(after)); }
      catch (error) { collection.reason = error.message; return collection; }
      collection.pages++;
      if (rows.length > options.pageSize || rows.some((row, i) => !uuid.test(row.id) || row.vehicle_id !== vehicleId ||
          (i ? row.id <= rows[i - 1].id : after !== null && row.id <= after))) { collection.reason = 'invalid_page'; return collection; }
      if (!rows.length) { collection.state = 'exhausted_selected_scope'; collection.reason = null; return collection; }
      collection.rows.push(...rows);
      after = rows.at(-1).id;
    }
    return collection;
  };
  for (const id of options.vehicleIds) {
    let parents;
    try { parents = await read('parent', id, planSQL('parent', { id })); }
    catch { capture.vehicles.push({ id, state: 'parent_read_failed', collections: {} }); continue; }
    if (parents.length !== 1 || parents[0].id !== id) { capture.vehicles.push({ id, state: 'parent_unavailable', collections: {} }); continue; }
    const parent = parents[0];
    const vehicle = { id, state: 'public_current_parent', parent, collections: {} };
    capture.vehicles.push(vehicle);
    const vin = typeof parent.vin === 'string' ? parent.vin.trim() : '';
    if (vin17.test(vin)) {
      try { vehicle.collections.vin_decode = { state: 'exhausted_selected_scope', rows: await read('vin_decode', id, planSQL('vin_decode', { id, vin })) }; }
      catch (error) { vehicle.collections.vin_decode = { state: 'partial', reason: error.message, rows: [] }; }
    } else vehicle.collections.vin_decode = { state: 'not_applicable', reason: 'vin_absent_or_not_17_characters', rows: [] };
    const page = { id, cutoff: capture.selection_cutoff, pageSize: options.pageSize };
    vehicle.collections.discoveries = await paged('discoveries', id, after => planSQL('discoveries', { ...page, after }));
    vehicle.collections.condition = await paged('condition', id, after => planSQL('condition', { ...page, after }));
    const { claims } = buildClaims(parent, vehicle.collections.discoveries.rows, vehicle.collections.condition.rows, table);
    const { operations } = matchOperations(claims, table, capture.reference, normalizers.year(parent.year));
    const terms = [...new Set(operations.flatMap(op => op.parts_terms))];
    const tokens = modelTokens(parent.model), year = normalizers.year(parent.year);
    vehicle.collections.parts = { state: 'not_applicable', reason: null, terms: {} };
    if (!terms.length) vehicle.collections.parts.reason = 'no_candidate_operation_with_parts_terms';
    else if (!tokens.length || year === null) vehicle.collections.parts.reason = 'record_year_or_model_tokens_missing';
    else {
      vehicle.collections.parts = { state: 'exhausted_selected_scope', reason: null, terms: {}, tokens, year,
        omitted_terms: terms.slice(MAX_PARTS_TERMS) };
      if (terms.length > MAX_PARTS_TERMS) { vehicle.collections.parts.state = 'partial'; vehicle.collections.parts.reason = 'term_budget'; }
      for (const term of terms.slice(0, MAX_PARTS_TERMS)) {
        try { vehicle.collections.parts.terms[term] = { state: 'read', rows: await read('parts', id, planSQL('parts', { id, term, tokens, year })) }; }
        catch (error) {
          vehicle.collections.parts.terms[term] = { state: error.message, rows: [] };
          vehicle.collections.parts.state = 'partial'; vehicle.collections.parts.reason = 'parts_read_incomplete';
        }
      }
    }
  }
  capture.ended_at = stamp();
  return capture;
}

export function buildPlanReport(capture) {
  if (capture?.schema_version !== PLAN_CAPTURE_VERSION || !Array.isArray(capture.vehicles) ||
      capture.keyword_table_sha256 !== sha(JSON.stringify(capture.keyword_table))) throw Error('Invalid plan capture');
  const table = validateKeywordTable(capture.keyword_table);
  const reference = capture.reference || {};
  const rate = reference.rate?.state === 'read'
    ? { state: 'as_returned', value: reference.rate.value, call: 'public.resolve_labor_rate() with no arguments',
      contract_branch: 'not_executed_requires_client_and_organization',
      interpretation: 'Shown exactly as returned. A placeholder unless source is contract, user or organization; never a provider rate. Not multiplied into hours here.' }
    : { state: 'unknown', reason: reference.rate?.state ?? 'not_read' };
  const vehicles = capture.vehicles.map(vehicle => {
    if (vehicle.state !== 'public_current_parent') return { vehicle_id: vehicle.id, state: vehicle.state,
      gaps: [{ reason: vehicle.state }], identity: null, claims: [], candidate_operations: [], parts: [], ppi_checklist: [] };
    const parent = vehicle.parent, c = vehicle.collections;
    const gaps = [];
    for (const [family, collection] of Object.entries(c))
      if (!['exhausted_selected_scope', 'not_applicable'].includes(collection.state)) gaps.push({ family, reason: collection.reason || 'incomplete_read' });
    if (parent.description_bytes > MAX_TEXT) gaps.push({ family: 'parent', reason: 'description_budget' });
    if (!parent.description) gaps.push({ family: 'parent', reason: 'listing_text_absent' });
    for (const kind of ['labor_operations', 'stage_map']) if (reference[kind]?.state !== 'read') gaps.push({ family: kind, reason: reference[kind]?.state ?? 'not_read' });
    const extraction = [...c.discoveries.rows].filter(r => r.is_failure !== true && r.raw_extraction && typeof r.raw_extraction === 'object' &&
      V3_KEYS.some(k => r.raw_extraction[k] != null))
      .sort((a, b) => String(b.discovered_at).localeCompare(String(a.discovered_at)) || b.id.localeCompare(a.id))[0] || null;
    const identity = buildIdentity(parent, c.vin_decode.rows, extraction, table);
    const { claims, exclusions } = buildClaims(parent, c.discoveries.rows, c.condition.rows, table);
    const year = normalizers.year(parent.year);
    const { operations, keyword_matches_excluded_by_rule } = matchOperations(claims, table, reference, year);
    exclusions.keyword_matches_excluded_by_rule = keyword_matches_excluded_by_rule;
    const identityBlocks = ['year', 'make', 'model'].some(f => identity.fields[f].status === 'conflict');
    const parts = [...new Set(operations.flatMap(op => op.parts_terms))].map(term => {
      const read = c.parts.terms?.[term];
      const base = { term, operation_ids: operations.filter(op => op.parts_terms.includes(term)).map(op => op.operation_id),
        fitment: 'text_match_unverified', price_basis: 'catalog_parts.price_current_as_recorded',
        identity_dependency: identityBlocks ? 'identity_conflict_unresolved_fitment_unusable' : 'record_identity_unverified' };
      if (!read) return { ...base, state: 'not_read', reason: c.parts.reason || 'term_budget', rows: [] };
      if (read.state !== 'read') return { ...base, state: 'read_incomplete', reason: read.state, rows: [] };
      return { ...base, state: read.rows.length ? 'priced_text_fitment_match' : 'no_priced_text_fitment_match',
        match_rule: { model_tokens: c.parts.tokens, year: c.parts.year, rule: 'name ILIKE term AND fits_models token AND year in [year_start, year_end] AND price_current > 0' },
        rows: read.rows.map(r => ({ catalog_part_id: r.id, part_number: r.part_number ?? null, name: r.name,
          price_current: r.price_current === null ? null : Number(r.price_current), currency: r.currency ?? null,
          fits_models: r.fits_models, year_start: r.year_start, year_end: r.year_end, manufacturer: r.manufacturer ?? null })) };
    });
    const ppi = buildChecklist(identity, claims, operations);
    const operable = claims.filter(cl => OPERATION_KINDS.has(cl.kind));
    const unmatched = operable.filter(cl => !operations.some(op => op.claim_ids.includes(cl.claim_id))).map(cl => cl.claim_id);
    return { vehicle_id: vehicle.id, state: vehicle.state,
      record_label: [parent.year, parent.make, parent.model].filter(v => v != null).join(' '),
      listing_url: sourceUrl(parent.listing_url || parent.bat_auction_url || parent.discovery_url),
      identity, claims, exclusions,
      candidate_operations: operations.map(({ parts_terms, ...op }) => op),
      parts, ppi_checklist: ppi,
      operation_coverage: { eligible_claims: operable.length, matched_claims: operable.length - unmatched.length,
        claims_without_reference_operation: unmatched,
        basis: 'eligible = listing_statement, defect_or_condition and condition_summary claims; matched = at least one keyword-table entry' },
      counts: { claims: claims.length, identity_conflicts: identity.conflicts.length,
        identity_unresolved_specificity: identity.unresolved_specificity.length,
        candidate_operations: operations.length, ppi_items: ppi.length,
        claims_by_kind: claims.reduce((m, cl) => ({ ...m, [cl.kind]: (m[cl.kind] || 0) + 1 }), {}) },
      collections: Object.fromEntries(Object.entries(c).map(([k, v]) => [k, { state: v.state, reason: v.reason ?? null,
        pages: v.pages ?? null, fetched_rows: Array.isArray(v.rows) ? v.rows.length : null }])),
      gaps };
  });
  return { schema_version: PLAN_VERSION, generated_at: stamp(), retrieval_started_at: capture.started_at,
    retrieval_ended_at: capture.ended_at, selection_cutoff: capture.selection_cutoff, snapshot_semantics: capture.snapshot_semantics,
    scope: { vehicle_ids: capture.options.vehicleIds, selection: 'operator_supplied_vehicle_ids', market_coverage: 'unmeasured' },
    keyword_table: { schema_version: table.schema_version, reviewed_at: table.reviewed_at, review_state: table.review_state,
      sha256: capture.keyword_table_sha256, entries: table.entries.length },
    rate,
    retrieval_boundary: { claim_sources: ['vehicles.description (lexical condition/unresolved-work sentences)',
      'description_discoveries (non-failure rows, v3 keys)', 'vehicle_observations kind=condition (rubric, text, listing-attributed image inference)'],
      not_read: ['comment_discoveries', 'auction_comments', 'component_identifications', 'image_condition_observations',
        'vehicle_condition_scores', 'listing_page_snapshots'],
      image_attribution_rule: 'image claim counts only when its vehicle_images row is on this vehicle, nonsensitive, and its source is a reviewed listing-import source for the listing host',
      raw_image_pixels: 'not_interpreted' },
    finding_slot_contract: { inspection_type: 'pre_purchase', verdict: ['supports', 'contradicts', 'unknown'],
      severity: ['info', 'monitor', 'concern', 'critical'], system: [...SYSTEMS],
      reference: 'docs/library/reference/dictionary/inspection.md' },
    model_calls: 0, database_writes: 0, scraping: 'none',
    interpretation: 'An estimate to inspect, not an estimate to restore. Claims are listing testimony; operations are keyword-table candidates with seed_uncalibrated reference hours; parts are unverified text-fitment matches; the rate is shown as returned. The pre-purchase inspection turns each item into an observation.',
    vehicles };
}

const fmtHours = h => h ? `${h.min ?? '?'} / ${h.typical ?? '?'} / ${h.max ?? '?'} h` : 'unknown';

export function renderPlanText(report) {
  const lines = ['LISTING INSPECTION PLAN (read-only; estimate to inspect, not to restore)',
    `Retrieved ${report.retrieval_started_at} to ${report.retrieval_ended_at}. Model calls 0, database writes 0.`,
    `Keyword table ${report.keyword_table.schema_version} reviewed ${report.keyword_table.reviewed_at} (${report.keyword_table.review_state}), ${report.keyword_table.entries} entries.`,
    report.rate.state === 'as_returned'
      ? `Rate as returned by resolve_labor_rate(): ${report.rate.value.rate} source=${report.rate.value.source} confidence=${report.rate.value.rate_confidence} n=${report.rate.value.authenticated_sample_n ?? 'unknown'}. Not applied to hours.`
      : `Rate: unknown (${report.rate.reason}).`, ''];
  for (const v of report.vehicles) {
    lines.push(`== ${v.record_label || v.vehicle_id} [${v.vehicle_id}]`);
    if (v.state !== 'public_current_parent') { lines.push(`   unavailable: ${v.state}`, ''); continue; }
    lines.push(`   listing: ${v.listing_url ?? 'unknown'}`, '   0. IDENTITY');
    for (const [field, info] of Object.entries(v.identity.fields)) {
      if (info.status === 'no_source') continue;
      const vals = [...new Set(info.values.map(x => `${x.source}=${x.value}`))].join('; ');
      lines.push(`      ${info.status === 'conflict' ? '!!' : info.status === 'unresolved_specificity' ? ' ?' : '  '} ${field}: ${info.status} (${vals})`);
    }
    lines.push(`      VIN decode: ${v.identity.vin_decode.state}`, `   1. CLAIMS: ${v.counts.claims} (${Object.entries(v.counts.claims_by_kind).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'})`);
    lines.push(`      excluded: ${Object.entries(v.exclusions).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}`);
    for (const cl of v.claims) lines.push(`      - [${cl.kind}] ${cl.verbatim_excerpt ? `"${cl.verbatim_excerpt.quote.trim()}"` : `${cl.text} (paraphrase; ${cl.excerpt_status})`} <${cl.source.ref}${cl.source.path}>`);
    lines.push(`   2. CANDIDATE OPERATIONS (seed_uncalibrated): ${v.candidate_operations.length}; ${v.operation_coverage.matched_claims} of ${v.operation_coverage.eligible_claims} condition claims matched a reference operation`);
    for (const op of v.candidate_operations) {
      lines.push(`      - ${op.keyword_entry_id} (${op.target_choice}; claims ${op.claim_ids.length}${op.review_flags.length ? `; review: ${op.review_flags.join(', ')}` : ''})`);
      for (const t of op.targets) lines.push(`          ${t.type} ${t.code ?? t.key?.zone_pattern ?? ''} ${t.name ?? t.description ?? ''}: ${t.state === 'resolved' ? `${fmtHours(t.hours)} [${t.range_basis}]${t.materials ? ` materials ${t.materials.min}-${t.materials.max} (${t.materials.currency})` : ''}${t.year_applicability ? ` year ${t.year_applicability}` : ''}` : t.state}`);
    }
    lines.push(`   3. PARTS (text fitment, unverified): ${v.parts.length ? '' : 'none proposed'}`);
    for (const p of v.parts) lines.push(`      - ${p.term}: ${p.state}${p.rows.length ? ` ${p.rows.map(r => `${r.name} ${r.price_current} ${r.currency ?? ''}`).join(' | ')}` : ''} [${p.identity_dependency}]`);
    lines.push(`   4. PPI CHECKLIST (inspection_type pre_purchase): ${v.ppi_checklist.length} items`);
    v.ppi_checklist.forEach((item, i) => lines.push(`      [ ] ${i + 1}. ${item.question}`));
    if (v.gaps.length) lines.push(`   gaps: ${v.gaps.map(g => `${g.family ?? ''}:${g.reason}`).join(', ')}`);
    lines.push('');
  }
  lines.push(report.interpretation);
  return lines.join('\n');
}
