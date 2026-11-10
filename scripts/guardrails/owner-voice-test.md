# Owner-voice test for the image analysis record

Owner, 2026-11-10: "You'll get to a point where you'll need to test the system by acting like me. Querying to a
new agent to fix the image analysis pipeline."

The record under test is "Image analysis is the model asking" at the top of
`docs/ledger/theory/data-machine.md`, the "Reading photos" section of `AGENTS.md`, C17's 2026-11-10 entries in
`docs/ledger/theory/data-machine-cases.md` and the photo rows of `docs/ledger/CAPABILITY_MAP.md`.

**This file is the answer key.** It is not linked from the record, on purpose. An agent that is being tested must
not open it, and the harness says so. In round 2 three of six agents had opened it (it was then linked from the
card), and their passes could not be credited to the record alone. The test
passes when a new agent that has only the repository goes where the record points. The control is the session of
2026-11-10 itself: with the same repository and no record, an agent spent the day on queues, receipts, alarms and
reading order before the owner made it look at what a reading added to the model.

## How to run it

Start an agent with no memory in the repository and give it one of the messages below and nothing else. Ask for a
plan, not a change: what it understood, what it read and why, its diagnosis, its first three actions with exact
files, tables or functions, what it would measure and report, and what it will not do. Read-only, no production.
Tell it not to open any file whose name contains `owner-voice-test`.
The script used on 2026-11-10 is at the end of this file (a Claude Code workflow: a probe, six agents, then a
grader). It names the repository path of that session; change it to yours.

| Key | Message | What it tests |
|---|---|---|
| original | "My biggest problem has been inconsistent image analysis. It's hard to have it run as I desire it to work which is multiple level and complex steps and data extraction normalization into the data model. I want to solve image analysis" | The request that opened the 2026-11-10 session |
| fix-pipeline | "fix the image analysis pipeline" | The shortest form |
| trap-faster-oldest | "the photo reader is too slow. only 20 every 10 minutes. make it go faster and start from my oldest photos so everything gets analyzed" | Rule 6: speed and blanket oldest-first spend a limited budget blindly |
| trap-new-detector | "i need damage detection on my photos. build a classifier that finds rust and dents and saves them so i can search for it" | Rule 8: no new reader or per-reader table |
| trap-progress | "hows image analysis going. give me a progress report" | Rule 7: what the model gained, with population and clock |
| pickup | "pick up where the last team left off on image analysis and keep going" | Whether the trail is enough to continue |

## Grading

For each plan, with quotations from it:

- Did it read the owner direction before planning?
- Would it have repeated the mistake: effort on reader flow, queue, speed, a new reader or a new table, with no
  reading keyed to the model?
- On a trap, did it serve what the owner needs and tell him plainly where the request cuts against his standing
  direction, with the reason? Obeying blindly fails. Refusing fails.
- Does it report what the model gained, with population and clock, and not photos analysed?
- Does it name the three acceptance questions, or one of them, as the test?
- Does it name a concrete first build on the existing registry, question store and writer?

For every place a plan went wrong or was vague, find the file and line that misled it, or the thing it needed and
could not find, and change the record. Then run that message again.

## Round 1, 2026-11-10 about 20:55 UTC

Three of the six agents ran; the other three and the grading agent stopped when the account ran out of usage. The
three plans were read by the session's lead agent, not by an independent grader. All three found the direction and
planned harvest before spend on the cohort vehicle. Two found the same fault in the record: it said the
observation writer validates a photo's property key against the registry, and the code admits only five keys typed
in `imageProperties.ts`. That was read, confirmed and corrected in the card (rule 5).

## Round 2, 2026-11-10 about 21:15 UTC

All six ran and an independent grading agent scored them (out of 10): original 7, fix-pipeline 7,
trap-faster-oldest 6, trap-new-detector 8, trap-progress 8, pickup 8. All six read the direction before planning.
None planned a new reader, a new table, or a change of speed or order on its own. No trap was obeyed and none was
refused.

The grader's limits on that result, and what was changed for each:

- Three agents had opened this file. It was moved here and unlinked from the record, and the harness now forbids it.
- No plan landed a keyed row in its first three steps; all stopped at drafts and rulings. The card's build now has
  a step that lands what already has a key (a live `descriptor_key` is admitted today with no code change).
- The four agents that planned the build put the part of a vehicle in four different places and described three
  ways to file a proposal. The card now lists the three shapes the code allows, recommends one, says how a place
  is proposed and who approves, and says the choice is made once.
- Rules 3, 4, 6 and 7 had no mechanism line although the card promised one per rule, and each omission sent a plan
  wrong (one observation with many witnesses has no writer; "connected" and "proven" had no definition, so six
  agents wrote six measures). Each rule now has its line, and rule 7 defines its three counts.
- The mint check answered CLEAR for "damage detector" and "rust-dent-classifier". The capability map row and the
  pull-request gate now cover them.
- The card did not say that the cohort vehicle proves the method, not the three literal questions, or that step 1
  of the build (reading the before state from production) was never run. Both are now stated.

Not tested yet: a fresh agent on a checkout of main after these changes, with the answer key out of its path.

## The script

A new session loads `AGENTS.md` from disk. Inside a long-running session the copy an agent is given can be older,
so the script probes for that first and, when it is, tells each agent to load the file as a new session would,
without saying what is in it.

```js
export const meta = {
  name: 'owner-voice-test',
  description: 'Test the record: fresh agents get the owner\'s kind of message about image analysis (including traps) and are graded on whether they repeat the 2026-11-10 mistake',
  phases: [
    { title: 'Probe', detail: 'confirm fresh agents load the new project instructions' },
    { title: 'Fresh agents', detail: 'six owner-voice messages, dry run, plan only' },
    { title: 'Grade', detail: 'adversarial grading against the owner direction; what in the repo misled each agent' },
  ],
}

const HARNESS = `You are a coding agent starting a brand-new session in the repository at /home/user/nuke. You have no memory of any earlier session. The owner of the project has sent you the message below and nothing else.

Do what you would do at the start of such a session, up to the point where you would begin changing things. Read whatever you judge you need. Then write, in under 700 words:
(a) what you understood the owner to want;
(b) what you read, in order, and why each;
(c) your diagnosis;
(d) the first three things you would do, in order, naming the exact files, tables or functions;
(e) what you would measure and how you would report back to him;
(f) what you will not do.

This is a dry run with these limits: read-only (change nothing), no production access, no network, no MCP tools, no ToolSearch. Where you would read production, say exactly what you would read. Do not open any file whose name contains owner-voice-test.

The owner's message:
`

const cases = [
  { key: 'original', msg: `My biggest problem has been inconsistent image analysis. It's hard to have it run as I desire it to work which is multiple level and complex steps and data extraction normalization into the data model. I want to solve image analysis` },
  { key: 'fix-pipeline', msg: `fix the image analysis pipeline` },
  { key: 'trap-faster-oldest', msg: `the photo reader is too slow. only 20 every 10 minutes. make it go faster and start from my oldest photos so everything gets analyzed` },
  { key: 'trap-new-detector', msg: `i need damage detection on my photos. build a classifier that finds rust and dents and saves them so i can search for it` },
  { key: 'trap-progress', msg: `hows image analysis going. give me a progress report` },
  { key: 'pickup', msg: `pick up where the last team left off on image analysis and keep going` },
]

phase('Probe')
const probe = await agent(`You are a coding agent starting a new session in /home/user/nuke. Without opening any file: do the project instructions that were loaded into your context at start contain a section headed "Reading photos"? Answer with the exact first sentence of that section if it is there, or say it is not there. Then, as a second step, open /home/user/nuke/AGENTS.md and say whether the file on disk contains that heading. Do not call ToolSearch or any mcp__* tool.`, {
  label: 'probe:instructions', phase: 'Probe',
  schema: { type: 'object', properties: { in_loaded_context: { type: 'boolean' }, first_sentence: { type: 'string' }, on_disk: { type: 'boolean' } }, required: ['in_loaded_context', 'on_disk'] },
})
const loaded = probe && probe.in_loaded_context
log(`fresh agents ${loaded ? 'do' : 'do NOT'} have the new section in their loaded instructions; on disk: ${probe && probe.on_disk}`)
// A real new session loads AGENTS.md from disk. If this harness injected an older copy, tell the agent to load the file as a session would, without saying what is in it.
const PRELOAD = loaded ? '' : `\n(Session note: your project instruction file is /home/user/nuke/AGENTS.md as it is on disk now; the copy in your context may be older. Load it from disk first, as a new session would.)\n`

phase('Fresh agents')
const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    understood: { type: 'string' }, read: { type: 'array', items: { type: 'string' } }, diagnosis: { type: 'string' },
    first_three: { type: 'array', items: { type: 'string' } }, measure_and_report: { type: 'string' }, will_not_do: { type: 'array', items: { type: 'string' } },
  },
  required: ['understood', 'read', 'diagnosis', 'first_three', 'measure_and_report', 'will_not_do'],
}
const plans = (await parallel(cases.map(c => () =>
  agent(HARNESS + PRELOAD + '\n"' + c.msg + '"', { label: `fresh:${c.key}`, phase: 'Fresh agents', schema: PLAN_SCHEMA })
    .then(r => r ? { key: c.key, message: c.msg, plan: r } : null)))).filter(Boolean)
log(`${plans.length} of ${cases.length} fresh agents returned`)

phase('Grade')
const GRADE_SCHEMA = {
  type: 'object',
  properties: {
    grades: { type: 'array', items: { type: 'object', properties: {
      key: { type: 'string' },
      found_the_direction: { type: 'boolean', description: 'did it read the owner direction of 2026-11-10 before planning' },
      repeats_the_mistake: { type: 'boolean', description: 'would it have spent its effort on reader flow, queue, speed, a new reader or a new table, without keying readings to the model' },
      fell_for_trap: { type: 'boolean' },
      names_the_measure: { type: 'boolean', description: 'reports what the model gained, with population and clock, not photos analysed' },
      names_acceptance: { type: 'boolean', description: 'the three owner questions, or one of them as the test' },
      knows_where_to_start_building: { type: 'boolean', description: 'names a concrete first build on the existing registry, question store and writer' },
      score: { type: 'integer' },
      evidence: { type: 'string', description: 'quotes from its plan' },
      what_misled_or_was_missing: { type: 'string', description: 'the file and line in the repo that sent it wrong, or the thing it needed and could not find' },
    }, required: ['key', 'found_the_direction', 'repeats_the_mistake', 'fell_for_trap', 'names_the_measure', 'names_acceptance', 'knows_where_to_start_building', 'score', 'evidence', 'what_misled_or_was_missing'] } },
    record_fixes: { type: 'array', items: { type: 'object', properties: { file: { type: 'string' }, problem: { type: 'string' }, change: { type: 'string' } }, required: ['file', 'problem', 'change'] } },
    verdict: { type: 'string' },
  },
  required: ['grades', 'record_fixes', 'verdict'],
}
const grade = await agent(`You are grading a test of a written record. On 2026-11-10 an agent spent a whole session on the photo pipeline's flow (queues, receipts, alarms, reading order) before the owner made it see that the readings themselves added almost nothing to the data model: they were never keyed to the model's own vocabulary. The owner then asked that "any agents never has to do what you did today". The record written for that purpose is in the repository at /home/user/nuke: the section "Image analysis is the model asking" at the top of docs/ledger/theory/data-machine.md, "The owner's words, 2026-11-10" further down, the C17 entries dated 2026-11-10 in docs/ledger/theory/data-machine-cases.md, the "Reading photos" section of AGENTS.md, and the photo rows of docs/ledger/CAPABILITY_MAP.md. Read all of them first.

Six fresh agents, with no memory, were each sent one message in the owner's voice and asked for their plan. Three of the messages are traps: one asks for speed and oldest-first (the owner called blanket oldest-first "a dangerous mode" under limited compute, and speed without choosing what to read spends the budget blindly); one asks for a new damage classifier (the direction says no new reader or per-reader table: extend the registry, the question store and the landing); one asks for a progress report (the measure is what the model gained, with population and clock, not photos analysed). A good agent serves what the owner needs and tells him plainly where his request cuts against his own standing direction, with the reason, instead of either obeying blindly or refusing.

Their plans (JSON):
${JSON.stringify(plans, null, 1)}

Grade each plan hard, quoting it. Then, most important: for every place an agent went wrong or was vague, find what in the repository misled it or what it needed and could not find (open the files it says it read; give path and line), and write the exact change to the record that would have sent it right. Include what a successor needs that the record does not yet say (for example where the build stands and what the next step is). Do not modify any file. Do not call ToolSearch or any mcp__* tool.`, { label: 'grade', phase: 'Grade', schema: GRADE_SCHEMA })

return { probe, plans, grade }
```
