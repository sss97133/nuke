export const meta = {
  name: 'timeline-day-walk',
  description: 'Chronological per-day photo re-attribution: parallel vision classify (read-only) → single serial writer (sanctioned RPC) → audit. Robust against API lock contention.',
  phases: [
    { title: 'Classify', detail: 'parallel, read-only: each agent pulls a day, classifies by pixels, writes decisions.json. NO db writes.' },
    { title: 'Apply', detail: 'single serial writer: applies every day\'s decisions via reattribute_observation + gate + build-day. No concurrent writers = no lock contention.' },
    { title: 'Audit', detail: 'verify lineage, gate counts, zero high-confidence misattributions left live.' },
  ],
}

// args = CSV or JSON array of "YYYY-MM-DD" dates
let dates = []
if (Array.isArray(args)) dates = args
else if (typeof args === 'string') {
  const s = args.trim()
  try { const p = JSON.parse(s); dates = Array.isArray(p) ? p : [String(p)] }
  catch { dates = s.split(/[,\s]+/).filter(Boolean) }
} else if (args && Array.isArray(args.dates)) dates = args.dates
if (!dates.length) log('WARN: no dates parsed from args — nothing to do')

const CLASSIFY_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['date', 'photo_count', 'decisions_written'],
  properties: {
    date: { type: 'string' },
    photo_count: { type: 'number' },
    decisions_written: { type: 'boolean' },
    tally: {
      type: 'object', additionalProperties: false,
      required: ['confirm', 'reattribute', 'personal', 'ambiguous'],
      properties: { confirm: {type:'number'}, reattribute:{type:'number'}, personal:{type:'number'}, ambiguous:{type:'number'} },
    },
    notes: { type: 'string' },
  },
}

const classifyPrompt = (date) => `You classify ONE day's vehicle photos by PIXELS. READ-ONLY — you must NOT write to any database. Work inside /Users/skylar/nuke.

DAY: ${date}

STEPS:
1. Run: dotenvx run --quiet -- node scripts/timeline/pull-day.mjs --date ${date}
2. Read /tmp/day/${date}/manifest.json (candidates[] = {vehicle_id,label,vin,reference_image}; photos[] = {file,id,current_vehicle_id,source,vision_gate_status,caption}).
3. Read each candidate's reference image (paths in manifest, under /tmp/refs/ or /tmp/day/${date}/reference/) so you know what each candidate looks like.
4. Read EVERY photo /tmp/day/${date}/<file>. Decide by PIXELS, ignoring captions (poisoned). Per photo:
   - "confirm": genuinely shows its current_vehicle_id (matches that candidate's reference).
   - "reattribute": shows a DIFFERENT candidate from candidates[] whose reference you verified — set target_vehicle_id to it. Only if it's IN candidates[]. Else "ambiguous".
   - "personal": not a vehicle (painting, surfboard, food, person-as-subject, document, landscape) or a generic part with no identifiable vehicle. A render/illustration that clearly depicts a candidate truck = confirm/reattribute, not personal.
   - "ambiguous": can't tell, or shows a vehicle not in the candidate set. NEVER guess.
5. Write /tmp/day/${date}/decisions.json EXACTLY: {"date":"${date}","decisions":[{"id":"<photo id>","verdict":"confirm|reattribute|personal|ambiguous","target_vehicle_id":"<uuid if reattribute>","reason":"<short pixel reason>"}, ...]} — one entry per photo, using manifest photo .id.
6. DO NOT run apply-day. DO NOT run any psql/curl/RPC writes. Your only output is decisions.json + the structured summary.`

const applyPrompt = (dateList) => `You are the SINGLE SERIAL WRITER. Apply pre-computed day decisions one date at a time so there is NO concurrent write contention. Work inside /Users/skylar/nuke.

For EACH date in this list, in order: ${dateList.join(', ')}
  - Confirm /tmp/day/<date>/decisions.json exists (skip the date if missing, note it).
  - Run: dotenvx run --quiet -- node scripts/timeline/apply-day.mjs --date <date>
  - If apply-day reports err>0 (transient lock-timeout), run it ONCE more for that date (it is idempotent).
  - Capture the printed tally line.
Run them strictly sequentially — never in parallel. Report a per-date tally summary and any dates skipped or still erroring.`

// CLASSIFY-ONLY. Overnight lesson: agents are unreliable at the WRITE step
// ("completed without doing the work"). So this workflow only does parallel,
// read-only vision classification → writes decisions.json per day. The APPLY
// is done deterministically afterward by scripts/timeline/apply-all.sh (a serial
// bash loop calling apply-day.mjs), and audit by a read-only SQL pass. Pen = code.
phase('Classify')
const classified = await parallel(
  dates.map(d => () => agent(classifyPrompt(d), { label: `classify:${d}`, phase: 'Classify', schema: CLASSIFY_SCHEMA }))
)
const ok = classified.filter(Boolean)
const ready = ok.filter(r => r.decisions_written).map(r => r.date)
log(`classified ${ready.length}/${dates.length} days → decisions.json written. Apply deterministically with apply-all.sh.`)

return { classified: ready.length, total: dates.length, ready, results: ok }
