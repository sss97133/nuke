export const meta = {
  name: 'keys-one-photo-at-a-time',
  description: 'Dry run: the keys role keys one photo per agent; each result is returned as data and checked by code afterwards',
  phases: [{ title: 'Key one photo', detail: 'one agent per photo, nothing shared but the registry and the decisions file' }],
}
// args.dir: the private data folder, outside the repository (the same folder as KEYS_DRY_RUN_DATA).
const DIR = args.dir
const N = { type: ['string', 'null'] }
const SCHEMA = {
  type: 'object',
  properties: {
    photo: { type: 'string' },
    results: { type: 'array', items: { type: 'object', properties: {
      sid: { type: 'string' },
      claims: { type: 'array', items: { type: 'object', properties: {
        part: { type: 'object', properties: { decision: { type: 'string', enum: ['existing', 'decided_before', 'no_place', 'unknown'] }, key: N, side: { type: ['string', 'null'], enum: ['driver', 'passenger', 'center', null] } }, required: ['decision', 'key', 'side'] },
        state: { type: 'object', properties: { decision: { type: 'string', enum: ['property', 'condition_key', 'decided_before', 'no_place'] }, property_key: N, value_or_key: { type: 'string' } }, required: ['decision', 'property_key', 'value_or_key'] },
        said: { type: 'string' },
      }, required: ['part', 'state', 'said'] } },
      not_a_claim: N, question: N,
    }, required: ['sid', 'claims', 'not_a_claim', 'question'] } },
    proposals: { type: 'array', items: { type: 'object', properties: { kind: { type: 'string', enum: ['part', 'property_value', 'condition_key'] }, key: { type: 'string' }, why_no_existing_key_fits: { type: 'string' }, nearest_existing: { type: 'string' } }, required: ['kind', 'key', 'why_no_existing_key_fits', 'nearest_existing'] } },
    unsure: { type: 'string' },
  },
  required: ['photo', 'results', 'proposals', 'unsure'],
}
const decisionsFile = (args && args.decisions) || null
const prompt = (photo) => `You are the dedicated image-keys role for this repository. Your brief is skills/image-keys/SKILL.md in this repository. Read it first, whole, and follow its procedure and its Never list exactly.

You key ONE photo. This is a dry run: you write no file and change nothing. You return your result as data.
Hard limits: do not use ToolSearch. Do not call any tool whose name starts with mcp__. No network. Do not open scripts/guardrails/owner-voice-test.md or docs/ledger/theory/image-keys-test.md. Under ${DIR} open only the files named here.
Keep your reasoning short: read the four inputs, decide, return.

INPUTS, all under ${DIR} (private data about one owner vehicle; never copy any of it into the repository):
- in/registry.md : the context and the registry snapshot. Read all of it.
- ${decisionsFile ? `${decisionsFile} : "decisions so far" for THIS vehicle: a part map, state decisions and conventions. They are binding. Where a decision covers a wording, use its key (decision "decided_before"). Never decide differently from a decision you were given; if you believe one is wrong, keep it and say so in unsure.\n- ` : ''}k10_seed.json : ${decisionsFile ? 'keys drafted earlier for another vehicle (a pickup); pending, not approved. Reuse one when it is the same thing and the decisions do not already cover it.' : '"decisions so far": keys drafted for the first vehicle that was keyed (a pickup); pending, not approved. Reuse a drafted key when it is the same thing (decision "decided_before").'}
- units/${photo}.json : the one photo: its capture day, its scene, and the statements a reader made about it.

TASK. Key every statement of this photo by the brief. Do NOT fold; one entry per statement. Folding across photos is done in code afterwards.

CONVENTIONS, fixed for every run so that runs agree:
- "scene" is context about this photo. It may place a statement that names no part at a scene-level key (undercarriage, engine.bay, interior.cabin, exterior.front and so on) only when the statement is plainly about what the photo shows as a whole. Otherwise the part key is null with decision "unknown".
- A negative finding is a claim when the reader affirms it about a named part or the visible surface: "no rust is visible on the exterior surfaces shown" is property image_visible_rust_severity = none. "X cannot be assessed", "is not established", "is unresolved", "unverified", "reflections prevent assessment" are not claims: put them in not_a_claim with the reason, or in question when it is a question the reader could not answer.
- A statement may hold several claims; give each one separately. A statement may have claims and also a question.
- side is one of driver, passenger, center, or null. This is a US car: left is driver, right is passenger. "image left" or "image right" is a position in the picture, not a side of the car: null.
- Where no decision and no registry key is true of the statement, draft a key by the brief (decision "no_place") in the registry's naming pattern: lower case, dots, general to specific. Prefer one key with a side value over two keys. Add one entry to proposals for each drafted key.
- "said" is copied from the statement, word for word, at most 80 characters. It is checked by code against the statement.
- Never use a baseline, score or "assessed" key.

Every statement id of the photo appears exactly once in results. Each entry has at least one of: a non-empty claims list, a not_a_claim reason, a question. In unsure, say plainly anything you were unsure of, or "nothing".`
phase('Key one photo')
const photos = (args && args.photos) || []
const out = await parallel(photos.map(p => () =>
  agent(prompt(p), { label: `one:${p}`, phase: 'Key one photo', schema: SCHEMA, effort: 'medium' }).then(r => ({ photo: p, result: r }))))
return out.map((r, i) => r || { photo: photos[i], result: null })
