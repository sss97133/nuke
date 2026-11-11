export const meta = {
  name: 'keys-batches',
  description: 'Dry run: the keys role keys small batches of the vehicle statements and receipt lines, bound by the shared decisions',
  phases: [{ title: 'Key', detail: 'one agent per batch, each bound by decisions v1' }],
}
// args.dir: the private data folder, outside the repository (the same folder as KEYS_DRY_RUN_DATA).
const DIR = args.dir
const SCHEMA = {
  type: 'object',
  properties: {
    out_path: { type: 'string' }, items: { type: 'integer' }, claims: { type: 'integer' },
    not_a_claim: { type: 'integer' }, questions: { type: 'integer' },
    part_keys_drafted: { type: 'array', items: { type: 'string' } }, state_keys_drafted: { type: 'array', items: { type: 'string' } },
    decisions_i_disagree_with: { type: 'array', items: { type: 'string' } },
    json_validated: { type: 'boolean' }, notes: { type: 'string' },
  },
  required: ['out_path', 'items', 'part_keys_drafted', 'state_keys_drafted', 'json_validated', 'notes'],
}
const HEAD = `You are the dedicated image-keys role for this repository. Your brief is skills/image-keys/SKILL.md in this repository. Read it first, whole, and follow its procedure and its Never list exactly.

This is a dry run. You write exactly one file, named below, and nothing else: you do not change the repository, you do not touch any database, you do not run git commands that change anything.
Hard limits: do not use ToolSearch. Do not call any tool whose name starts with mcp__. No network. Do not open scripts/guardrails/owner-voice-test.md or docs/ledger/theory/image-keys-test.md. Do not open any other file under ${DIR}/out or ${DIR}/verify: other runs are keying other batches and you must not see their work.

HOW TO WORK: keep your reasoning short. Decide each item, write the file, check it, return. The file is small (under about 15 KB).

INPUTS, all under ${DIR} (private data about one owner vehicle; never copy any of it into the repository):
- in/registry.md : the context and the registry snapshot. Read all of it.
- decisions-v1.json : "decisions so far" for THIS vehicle: a part map, state decisions and conventions made by the run that keyed the first batch. These are binding. Where a decision covers a wording, use its key. Never decide differently from a decision you were given; if you believe one is wrong, keep it and name it in decisions_i_disagree_with.
- k10_seed.json : keys drafted earlier for another vehicle (a pickup); pending, not approved. Reuse one when it is the same thing and decisions-v1 does not already cover it.`
const RULES = `CONVENTIONS, fixed for every run so that runs agree (decisions-v1.json adds more; follow those too):
- "scene" is context about the same photo. It may place a statement that names no part at a scene-level key (undercarriage, engine.bay, interior.cabin, exterior.front and so on) only when the statement is plainly about what the photo shows as a whole. Otherwise the part key is null with decision "unknown".
- A negative finding is a claim when the reader affirms it about a named part or the visible surface: "no rust is visible on the exterior surfaces shown" is property image_visible_rust_severity = none. "X cannot be assessed", "is not established", "is unresolved", "reflections prevent assessment" are not claims: put them in not_a_claim with the reason, or in question when it is a question the reader could not answer.
- A statement may hold several claims; give each one separately. A statement may have claims and also a question.
- side is one of driver, passenger, center, or JSON null. This is a US car: left is driver, right is passenger. "image left" or "image right" is a position in the picture, not a side of the car: null.
- Where no decision and no registry key is true of the item, draft a key by the brief (decision "no_place") in the registry's naming pattern: lower case, dots, general to specific. Prefer one key with a side value over two keys. Another run will merge drafts across batches, so name a draft the plainest way and add one entry to proposals for it.
- Never use a baseline, score or "assessed" key.`
const chunkPrompt = (nn) => `${HEAD}
- in/chunk-${nn}.json : the statements for you to key, each with id, photo, day, scene, text.

TASK. Key every statement in in/chunk-${nn}.json by the brief. One difference from the brief's output: do NOT fold. One entry per statement; folding is done in code afterwards.

${RULES}

OUTPUT FILE: ${DIR}/out/chunk-${nn}.json
{"chunk":"${nn}",
 "results":[{"sid":"s0001",
   "claims":[{"part":{"decision":"existing|decided_before|no_place|unknown","key":"<key or null>","side":"driver|passenger|center|null"},
              "state":{"decision":"property|condition_key|decided_before|no_place","property_key":"<property key or null>","value_or_key":"<listed value, condition key, or drafted key>"},
              "said":"<at most 80 characters of the reader's own words this rests on>"}],
   "not_a_claim":null,
   "question":null}],
 "proposals":[{"kind":"part|property_value|condition_key","key":"...","why_no_existing_key_fits":"...","nearest_existing":"..."}]}
Rules: every statement id of the batch appears exactly once in results. Each entry has at least one of: a non-empty claims list, a not_a_claim reason (string), a question (string). Every drafted key (decision no_place) has one entry in proposals.

Before you finish: load the file with python3 (json.load) to prove it parses, and check with a short python3 snippet that the set of sids in results equals the set of ids in the batch. Fix anything that fails. Then return the summary fields (items = the number of statements). In notes, say plainly anything you were unsure of.`
const receiptPrompt = (b) => `${HEAD}
- in/receipt-${b}.json : receipt lines for parts bought for this vehicle, each with line, description, zone, end_hint, bought.

TASK. For each receipt line say which part of the car it is, with the same part keys the photo statements use: one vocabulary for photos and receipts. Use the part map in decisions-v1.json first. A line that is a hardware kit, a fastener set, a consumable, shipping, a tool, a manual or decal sheet, or otherwise not one locatable part of the car gets kind "not_a_part" with a short reason. RH is passenger, LH is driver; a pair or a set has side null.

${RULES}

OUTPUT FILE: ${DIR}/out/receipt-${b}.json
{"batch":"${b}",
 "receipt_parts":[{"line":"r001","kind":"part|not_a_part","part":{"decision":"existing|decided_before|no_place","key":"<key or null>","side":"driver|passenger|center|null"},"reason":"<only for not_a_part>"}],
 "proposals":[{"kind":"part","key":"...","why_no_existing_key_fits":"...","nearest_existing":"..."}]}
Rules: every line of the batch appears exactly once. Every drafted key (decision no_place) has one entry in proposals.

Before you finish: load the file with python3 (json.load) to prove it parses, and check that the set of lines equals the set in the batch. Then return the summary fields (items = the number of lines; claims, not_a_claim and questions may be 0). In notes, say plainly anything you were unsure of.`
phase('Key')
const chunks = (args && args.chunks) || []
const receipts = (args && args.receipts) || []
const jobs = [
  ...chunks.map(nn => ({ id: `chunk-${nn}`, prompt: chunkPrompt(nn) })),
  ...receipts.map(b => ({ id: `receipt-${b}`, prompt: receiptPrompt(b) })),
]
const out = await parallel(jobs.map(j => () =>
  agent(j.prompt, { label: `keys:${j.id}`, phase: 'Key', schema: SCHEMA, effort: 'medium' }).then(r => ({ job: j.id, result: r }))))
return out.map((r, i) => r || { job: jobs[i].id, result: null })
