// The stack grammar (docs/ledger/theory/data-machine-cases.md section 13.2) as code: the nine layers, the prompt that
// teaches it to a small local model, the strict validator for what comes back, and a JSON extractor that survives
// the usual local-model habits (thinking blocks, code fences, trailing commas, a reply cut off mid-array).
import { tokens } from './common.mjs';

export const LAYERS = ['log', 'key', 'dimension', 'fold', 'baseline', 'residual', 'feature', 'prediction', 'outcome'];
// What a stack stands on. Its own fold, baseline, residual, feature and prediction are what it builds, so they are never
// needs (the stack registry seeds none either); a model that lists one anyway has it dropped and recorded.
export const NEED_LAYERS = ['log', 'key', 'dimension', 'outcome'];
export const NEED_KINDS = ['table', 'column', 'dimension', 'source'];
const TOP_KEYS = ['name', 'question', 'who_cares', 'layers', 'needs', 'external_dimensions', 'score_rule'];

export const GRAMMAR_TEXT = `You design "stacks" for Nuke, a vehicle data ledger (auction lots, bids, comments, photos, listings, owners, shops).
A stack is a path through nine typed layers. Each layer is a table with a declared grain, key and clock.
  log         append-only source rows; one source event; event clock and ingest clock
  key         every text reference turned into a foreign key (identity, lot, vehicle, place, part)
  dimension   taxonomy built from evidence (generation, body, engine, color, options, place, platform, part, failure mode)
  fold        state or aggregate per entity, replayable from the log, on a declared cadence
  baseline    expected value of a measure for a cohort as of a time
  residual    observed minus baseline, with the baseline version
  feature     a residual or fold indexed by entity and as-of time; uses only events before the as-of time (no leakage)
  prediction  feature set + model version + horizon, graded by a rule against a baseline
  outcome     what happened, joined back by key and clock
A page renders one path. A thesis is a prediction row waiting for its outcome row. A stack's coverage is how much of
each layer exists today. No number without its denominator. Unknown is an answer; never invent data.
Style of a finished stack (do not repeat it): "The auction as an order book". log = every bid comment as a timed quote;
key = bid to identity and lot; dimension = comment stance (bid, reservation, refusal); fold = implied demand curve per
lot per minute; baseline = the cohort's curve at the same minutes to close; residual = this lot's curve against its
cohort; feature = slope, depth and top-two gap as of each minute; prediction = hammer distribution and P(reserve met);
outcome = the hammer price.`;

export const SHAPE_TEXT = `OUTPUT: a JSON array with exactly {K} elements, one per stack, each exactly this shape and no other keys:
{"name": "<2 to 8 words, specific>",
 "question": "<one question a person could act on>",
 "who_cares": "<who pays for or decides on the answer>",
 "layers": {"log": "<sentence>", "key": "<sentence>", "dimension": "<sentence>", "fold": "<sentence>", "baseline": "<sentence>",
            "residual": "<sentence>", "feature": "<sentence>", "prediction": "<sentence>", "outcome": "<sentence>"},
 "needs": [{"layer": "key", "kind": "column", "object": "some_table.some_column"}, {"layer": "dimension", "kind": "dimension", "object": "short noun phrase"}],
 "external_dimensions": ["<data Nuke does not hold, for example census population by county>"],
 "score_rule": "<how a prediction is graded: metric, baseline, horizon>"}
RULES
- A good stack is something a person could act on or back, answered by data we hold or could get. Name the specific thing measured.
- needs: 3 to 10 things this stack stands on, which must exist before it can be built (a source table, a key column, a dimension, a record of outcomes). layer is exactly one of log, key, dimension, outcome. The stack's own fold, baseline, residual, feature and prediction are what we build, so they are never needs. kind is exactly one of table, column, dimension, source.
  kind "table": object is a table name. Use an exact name from the table list above when that table exists; otherwise a new snake_case name.
  kind "column": object is table.column in snake_case.
  kind "dimension": object is a short noun phrase (example: paint color family).
  kind "source": object is a short noun phrase for a feed or dataset (example: bid frames at second precision).
- Every layer value is one sentence of at most 25 words. Do not leave any of the nine layers out.
- external_dimensions may be an empty array. Each entry is a short phrase.
- Propose things that are new, specific and measurable. A stack repeats an existing one when it asks the same question of the same data, whatever it is called: do not restate or rephrase anything in the existing list.
- Reply with the JSON array only: double quotes, no trailing commas, no comments, no markdown fences, no text before or after.`;

export function buildPrompt({ k, focus, atlasText, existingNames, earlierNames, seeds = [] }) {
  const known = [...existingNames, ...earlierNames];
  return [
    GRAMMAR_TEXT,
    '',
    'THE DATA WE HAVE: live tables by rows, with the share of their columns that carry a description.',
    atlasText,
    '',
    'ALREADY EXISTING OR PROPOSED (do not repeat or rephrase any of these):',
    known.length ? known.map(n => `- ${n}`).join('\n') : '- (none)',
    '',
    ...(focus ? [`FOCUS FOR THIS BATCH: lean toward ${focus}. Any area is fine if the idea is strong.`] : []),
    ...(seeds.length ? [
      'SEED TABLES, one per stack in order. Use the seed as that stack\'s log or key layer and ask a question about it that no existing stack asks:',
      ...seeds.map((t, i) => `  stack ${i + 1}: ${typeof t === 'string' ? t : `${t.name}${t.purpose ? ` (${t.purpose})` : ''}`}`),
    ] : []),
    '',
    SHAPE_TEXT.replace('{K}', String(k)),
  ].join('\n');
}

export function buildRepairPrompt({ k, problem, errors = [] }) {
  const lines = errors.slice(0, 8).map(e => `- ${e}`);
  return [
    `Your last reply could not be used: ${problem}`,
    ...(lines.length ? ['Specific problems:', ...lines] : []),
    `Reply again with ONLY a JSON array of exactly ${k} stack proposals, each with the keys name, question, who_cares, layers (nine string values: ${LAYERS.join(', ')}),`,
    `needs (3 to 10 objects with layer, kind, object; layer is one of ${NEED_LAYERS.join(', ')} only), external_dimensions (array of strings) and score_rule. Keep every string short.`,
    'Double quotes, no trailing commas, no markdown fences, nothing before or after the array.',
  ].join('\n');
}

// ---------------------------------------------------------------------------------------------
// Extraction: pull proposal objects out of whatever text the model returned.
// ---------------------------------------------------------------------------------------------
function stripThinking(text) {
  let out = String(text ?? '').replace(/<think>[\s\S]*?<\/think>/gi, ' ');
  const open = out.search(/<think>/i); // an unterminated block means the reply was cut off while thinking
  if (open >= 0) out = out.slice(0, open);
  return out;
}

function stripFences(text) {
  const fenced = [...text.matchAll(/```(?:json|JSON)?\s*\n?([\s\S]*?)```/g)].map(m => m[1]);
  if (fenced.length) return fenced.join('\n');
  const open = text.search(/```(?:json|JSON)?/); // opening fence with no closing one: reply was truncated
  return open >= 0 ? text.slice(open).replace(/^```(?:json|JSON)?\s*/, '') : text;
}

/** Top-level {...} objects in `text` that are fully closed, in order. String- and escape-aware. */
function closedObjects(text) {
  const out = [];
  let depth = 0, start = -1, inString = false, escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') { if (depth === 0) start = i; depth++; }
    else if (c === '}' && depth > 0) { depth--; if (depth === 0 && start >= 0) { out.push(text.slice(start, i + 1)); start = -1; } }
  }
  return { objects: out, openTail: depth > 0 };
}

const tryParse = s => { try { return JSON.parse(s); } catch { return undefined; } };
const dropTrailingCommas = s => s.replace(/,\s*([}\]])/g, '$1');

/**
 * Returns { items, complete, problems }. items are parsed objects (not yet validated).
 * complete=false means the array was cut off; the closed objects before the cut are still returned.
 */
export function extractProposalObjects(rawText) {
  const text = stripFences(stripThinking(rawText)).trim();
  const problems = [];
  if (!text) return { items: [], complete: false, problems: ['empty reply'] };

  // 1) the whole thing is JSON (array, or an object wrapping an array, or a single proposal)
  const whole = tryParse(text) ?? tryParse(dropTrailingCommas(text));
  if (whole !== undefined) {
    if (Array.isArray(whole)) return { items: whole, complete: true, problems };
    if (whole && typeof whole === 'object') {
      if ('name' in whole && 'layers' in whole) return { items: [whole], complete: true, problems }; // one bare proposal
      const wrapped = Object.values(whole).find(Array.isArray);
      if (wrapped) return { items: wrapped, complete: true, problems };
    }
    return { items: [], complete: false, problems: ['JSON parsed but is not an array of proposals'] };
  }

  // 2) a JSON array somewhere inside prose
  const first = text.indexOf('[');
  const last = text.lastIndexOf(']');
  if (first >= 0 && last > first) {
    const slice = text.slice(first, last + 1);
    const parsed = tryParse(slice) ?? tryParse(dropTrailingCommas(slice));
    if (Array.isArray(parsed)) return { items: parsed, complete: true, problems: ['text around the array'] };
  }

  // 3) salvage: complete objects from an array that was cut off or is slightly broken
  const body = first >= 0 ? text.slice(first + 1) : text;
  const { objects, openTail } = closedObjects(body);
  const items = [];
  for (const piece of objects) {
    const parsed = tryParse(piece) ?? tryParse(dropTrailingCommas(piece));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) items.push(parsed);
    else problems.push('one object did not parse');
  }
  if (items.length) {
    problems.push(openTail ? 'reply cut off inside an element; kept the complete ones' : 'array did not parse as a whole; kept the objects that did');
    return { items, complete: false, problems };
  }
  return { items: [], complete: false, problems: ['no JSON array found in the reply'] };
}

// ---------------------------------------------------------------------------------------------
// Strict validation of one proposal.
// ---------------------------------------------------------------------------------------------
const PLACEHOLDER = /^(\.\.\.|…|string|text|sentence|tbd|todo|n\/a|none|null|unknown|<[^>]*>)$/i;
const clean = v => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : v);
const okText = (v, min, max) => typeof v === 'string' && v.length >= min && v.length <= max && !PLACEHOLDER.test(v) && /[a-z]/i.test(v);

export function normalizeObject(kind, object) {
  let o = String(object ?? '').trim().replace(/[`"']/g, '');
  if (kind === 'table' || kind === 'column') o = o.toLowerCase().replace(/^public\./, '').replace(/\s+/g, '_');
  return o;
}

/** @returns {{ok: boolean, errors: string[], value?: object}} */
export function validateProposal(raw) {
  const errors = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, errors: ['element is not an object'] };
  for (const key of Object.keys(raw)) if (!TOP_KEYS.includes(key)) errors.push(`unexpected key "${key}"`);
  for (const key of TOP_KEYS) if (!(key in raw)) errors.push(`missing "${key}"`);

  const name = clean(raw.name);
  if (!okText(name, 4, 80) || /[{}[\]"\n]/.test(name ?? '') || name.split(' ').length < 2 || /^(stack|proposal)\s*#?\d+$/i.test(name)) {
    errors.push('name must be 2 to 8 specific words, 4 to 80 characters');
  } else if (tokens(name).size === 0) errors.push('name has no content words');
  const question = clean(raw.question);
  if (!okText(question, 15, 300)) errors.push('question must be 15 to 300 characters');
  const whoCares = clean(raw.who_cares);
  if (!okText(whoCares, 3, 200)) errors.push('who_cares must be 3 to 200 characters');
  const scoreRule = clean(raw.score_rule);
  if (!okText(scoreRule, 10, 300)) errors.push('score_rule must be 10 to 300 characters');

  const layers = {};
  if (!raw.layers || typeof raw.layers !== 'object' || Array.isArray(raw.layers)) errors.push('layers must be an object');
  else {
    for (const key of Object.keys(raw.layers)) if (!LAYERS.includes(key)) errors.push(`unexpected layer "${key}"`);
    for (const layer of LAYERS) {
      const text = clean(raw.layers[layer]);
      if (typeof raw.layers[layer] !== 'string') errors.push(`layers.${layer} must be a string`);
      else if (!okText(text, 8, 300)) errors.push(`layers.${layer} must be 8 to 300 characters`);
      else layers[layer] = text;
    }
  }

  const needs = [];
  const dropped = [];
  if (!Array.isArray(raw.needs)) errors.push('needs must be an array');
  else {
    const seen = new Set();
    raw.needs.forEach((n, i) => {
      if (!n || typeof n !== 'object' || Array.isArray(n)) return errors.push(`needs[${i}] must be an object`);
      for (const key of Object.keys(n)) if (!['layer', 'kind', 'object'].includes(key)) errors.push(`needs[${i}] has unexpected key "${key}"`);
      const layer = String(n.layer ?? '').trim().toLowerCase();
      const kind = String(n.kind ?? '').trim().toLowerCase();
      if (!LAYERS.includes(layer)) return errors.push(`needs[${i}].layer must be one of ${LAYERS.join('|')}`);
      if (!NEED_KINDS.includes(kind)) return errors.push(`needs[${i}].kind must be one of ${NEED_KINDS.join('|')}`);
      const object = normalizeObject(kind, n.object);
      if (typeof n.object !== 'string' || PLACEHOLDER.test(object)) return errors.push(`needs[${i}].object must be a real name`);
      if (kind === 'table' && !/^[a-z_][a-z0-9_]{1,62}$/.test(object)) return errors.push(`needs[${i}] kind table needs a snake_case table name`);
      if (kind === 'column' && !/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/.test(object)) return errors.push(`needs[${i}] kind column needs table.column`);
      if ((kind === 'dimension' || kind === 'source') && !okText(object, 2, 80)) return errors.push(`needs[${i}].object must be 2 to 80 characters`);
      if (!NEED_LAYERS.includes(layer)) { dropped.push({ layer, kind, object }); return; } // what the stack builds, not what it stands on
      const id = `${layer}|${object.toLowerCase()}`; // the registry keys a need by layer and object
      if (seen.has(id)) return;
      seen.add(id);
      needs.push({ layer, kind, object });
    });
    if (needs.length < 3 || needs.length > 14) errors.push(`needs must hold 3 to 14 distinct entries at the layers ${NEED_LAYERS.join(', ')} (got ${needs.length}${dropped.length ? `; ${dropped.length} at the stack's own derived layers were dropped` : ''})`);
  }

  const external = [];
  if (!Array.isArray(raw.external_dimensions)) errors.push('external_dimensions must be an array');
  else {
    for (const [i, e] of raw.external_dimensions.entries()) {
      const text = clean(e);
      if (!okText(text, 3, 100)) errors.push(`external_dimensions[${i}] must be a phrase of 3 to 100 characters`);
      else if (!external.includes(text)) external.push(text);
    }
    if (external.length > 8) errors.push('external_dimensions holds at most 8 entries');
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, errors, value: { name, question, who_cares: whoCares, layers, needs, external_dimensions: external, score_rule: scoreRule, ...(dropped.length ? { dropped_needs: dropped } : {}) } };
}

/** JSON schema of a batch, for local runtimes that can constrain decoding (the opt-in Ollama path). */
export function batchSchema(k) {
  const text = (min, max) => ({ type: 'string', minLength: min, maxLength: max });
  return {
    type: 'array', minItems: k, maxItems: k,
    items: {
      type: 'object', additionalProperties: false, required: TOP_KEYS,
      properties: {
        name: text(4, 80), question: text(15, 300), who_cares: text(3, 200), score_rule: text(10, 300),
        layers: { type: 'object', additionalProperties: false, required: LAYERS, properties: Object.fromEntries(LAYERS.map(l => [l, text(8, 300)])) },
        needs: {
          type: 'array', minItems: 3, maxItems: 10,
          items: { type: 'object', additionalProperties: false, required: ['layer', 'kind', 'object'],
            properties: { layer: { enum: NEED_LAYERS }, kind: { enum: NEED_KINDS }, object: text(2, 80) } },
        },
        external_dimensions: { type: 'array', maxItems: 6, items: text(3, 100) },
      },
    },
  };
}
