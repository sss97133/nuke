export const meta = {
  name: 'keys-verify',
  description: 'Dry run: merge drafted names across batches, and have independent skeptics try to refute a sample of the keyed claims',
  phases: [{ title: 'Verify', detail: 'a reconciler for drafted names and three skeptics with different lenses' }],
}
// args.dir: the private data folder, outside the repository (the same folder as KEYS_DRY_RUN_DATA).
const DIR = args.dir
const LIMITS = `This is a dry run: you write no file and change nothing; you return data. Hard limits: do not use ToolSearch; do not call any tool whose name starts with mcp__; no network; do not open scripts/guardrails/owner-voice-test.md or docs/ledger/theory/image-keys-test.md. The files under ${DIR} are private data about one owner vehicle: never copy any of it into the repository. Under ${DIR} open only the files named here.`
const BRIEF = `The keys role's brief is skills/image-keys/SKILL.md in this repository (read it). The registry snapshot and context are in ${DIR}/in/registry.md (read it all). The decisions and conventions the keyers were bound by are in ${DIR}/decisions-v1.json (read the conventions list and consult the part and state decisions as needed).`
const VERDICTS = {
  type: 'object',
  properties: {
    verdicts: { type: 'array', items: { type: 'object', properties: {
      n: { type: 'integer' }, sid: { type: 'string' }, verdict: { type: 'string' }, why: { type: 'string' },
    }, required: ['n', 'sid', 'verdict', 'why'] } },
    pattern: { type: 'string', description: 'the one or two failure patterns you saw most, in plain words; or "none"' },
  },
  required: ['verdicts', 'pattern'],
}
const JOBS = {
  reconcile: {
    schema: { type: 'object', properties: {
      merges: { type: 'array', items: { type: 'object', properties: { kind: { type: 'string', enum: ['part', 'state'] }, from: { type: 'string' }, to: { type: 'string' }, why: { type: 'string' } }, required: ['kind', 'from', 'to', 'why'] } },
      keep: { type: 'array', items: { type: 'object', properties: { kind: { type: 'string', enum: ['part', 'state'] }, key: { type: 'string' }, meaning: { type: 'string' } }, required: ['kind', 'key', 'meaning'] } },
      should_not_exist: { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, why: { type: 'string' } }, required: ['key', 'why'] } },
      notes: { type: 'string' },
    }, required: ['merges', 'keep', 'should_not_exist', 'notes'] },
    prompt: `You are the reconciler for drafted keys. Thirty runs keyed one vehicle's photo statements in parallel. Each was bound by the same decisions, but where no decision and no registry key fit, each drafted its own key. Your job is the one step that needs the whole set: make each drafted thing have exactly one name.

${LIMITS}
${BRIEF}

Input: ${DIR}/in/drafts.json. "drafts" lists every key drafted during the parallel runs (kind part or state), how many claims use it, and up to three statements it was used on. "already_decided_parts" and "already_decided_states" list the keys drafted earlier and given to every run.

Return:
- merges: for every drafted key that names the same thing as another drafted key, as an already-decided key, or as an existing registry key, map it ("from") onto the one name to keep ("to"). Prefer, in order: an existing registry key that is true of it; an already-decided key; the plainest of the drafts in the registry's naming pattern. Merge only when the two are the same thing. Two different parts, or two different flaws, are never merged for tidiness.
- keep: every drafted key that stays as its own proposal, with one line on what it means.
- should_not_exist: a drafted key that is not a part or a state at all (a position in the picture, a scene, a doubt about the photo), with the reason.
Every key in "drafts" appears exactly once across merges (as "from"), keep, and should_not_exist.`,
  },
  part: {
    schema: VERDICTS,
    prompt: `You are a skeptic. Another agent read statements about one vehicle's photos and gave each claim a PART key. Try to refute each part key. Default to refuted when in doubt.

${LIMITS}
${BRIEF}

Input: ${DIR}/verify/sample-part.json: 70 rows, each with the statement, the scene, and the claim (part key, side, where the part key came from, state, and the words it rests on).

For each row judge only the PART and SIDE:
- "ok": the part key is true of what the statement says (or, for part null, the statement really names no part), and the side is said or correctly left empty.
- "stretched": the key is a neighbour or a broader or narrower thing than what was said, when a truer choice existed (a truer registry key, a decided key, or leaving it unknown).
- "invented": the statement does not support this part or this side at all.
- "too_vague": a specific part is named in the statement and the claim used a scene-level key or left it unknown.
A scene-level key for an unnamed small piece in an undercarriage or engine-bay photo follows the given conventions and is "ok". A drafted key is "ok" if no existing or decided key is true of the thing.
Return one verdict per row (n and sid copied from the row) with a short reason.`,
  },
  state: {
    schema: VERDICTS,
    prompt: `You are a skeptic. Another agent read statements about one vehicle's photos and gave each claim a STATE (a registered property and value, a condition key, or a drafted key). Try to refute each state. Default to refuted when in doubt.

${LIMITS}
${BRIEF}

Input: ${DIR}/verify/sample-state.json: 70 rows, each with the statement, the scene, and the claim (part, state, where the state came from, and the words it rests on).

For each row judge only the STATE:
- "ok": the reader affirms this, and the property value or key is true of what was said.
- "hedge_made_claim": the reader did not affirm it ("cannot be assessed", "not established", "may be a reflection", "unresolved") and it was keyed as a finding anyway.
- "wrong_value": the reader affirms something, but this value or key says something different, stronger or weaker than what was said (for example a rust severity the reader did not give, or "none" when the reader said "no major").
- "stretched": a key from a different kind of flaw or material was borrowed when a truer one existed.
The given conventions count: hedges such as "appears" or "no obvious" still make a claim; an affirmed negative is a claim only where a property has a none value.
Return one verdict per row (n and sid copied from the row) with a short reason.`,
  },
  notclaim: {
    schema: VERDICTS,
    prompt: `You are a skeptic. Another agent read statements about one vehicle's photos and decided that each of these statements makes NO claim (it is a hedge, a remark about the photo, or a question). Try to refute that: look for a real finding that was dropped. Default to "dropped" when in doubt.

${LIMITS}
${BRIEF}

Input: ${DIR}/verify/sample-notclaim.json: 70 rows, each with the statement, the scene and the keyer's reason for making no claim.

For each row:
- "ok": the statement affirms nothing about a part or the visible surface that the registry, the decisions or a reasonable draft could hold. Remarks about lighting, framing, what cannot be assessed, what is not established, and what a feature is not are correctly not claims under the given conventions.
- "dropped": the statement, or part of it, affirms something about the vehicle (a flaw, a state, a present or absent part, an affirmed "no rust") and no claim was made. Say what was dropped.
Return one verdict per row (n and sid copied from the row) with a short reason.`,
  },
}
phase('Verify')
const jobs = (args && args.jobs) || Object.keys(JOBS)
const out = await parallel(jobs.map(j => () =>
  agent(JOBS[j].prompt, { label: `verify:${j}`, phase: 'Verify', schema: JOBS[j].schema }).then(r => ({ job: j, result: r }))))
return out.map((r, i) => r || { job: jobs[i], result: null })
