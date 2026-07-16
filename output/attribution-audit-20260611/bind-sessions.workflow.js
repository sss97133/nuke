// Staged ringleader workflow — NOT installed. When authorized, this runs via
// the Workflow tool (or gets moved to .claude/workflows/bind-sessions.js).
// args = {sessions: [{id, frames:[urls], album_hint, gps, when}], registry_path}
export const meta = {
  name: 'bind-sessions',
  description: 'Bind photo capture sessions to vehicle anchors via cheap schema-forced binder agents',
  phases: [{ title: 'Bind', detail: 'one haiku binder per session' }],
}
const VERDICT = {
  type: 'object',
  required: ['session_id','verdict','evidence_tier','confidence','what_is_depicted'],
  properties: {
    session_id: {type:'string'},
    verdict: {enum:['anchored','hypothesis','non-vehicle','unbound']},
    vehicle_anchor: {type:['string','null']},
    evidence_tier: {enum:['vin_in_frame','doc_in_frame','visual_match','album_consistent','none']},
    confidence: {type:'number'},
    what_is_depicted: {type:'string'},
    flags: {type:'array', items:{type:'string'}},
  },
}
phase('Bind')
const prompt = (s) => `Read the binder rules at /Users/skylar/nuke/output/attribution-audit-20260611/binder-agent-prompt.md, read the anchor registry at ${args.registry_path}, then view these frames with the Read tool (curl to /tmp first if URLs): ${JSON.stringify(s.frames)}. Session ${s.id}: ${s.when} at GPS ${s.gps||'none'}. Owner album hint: ${s.album_hint||'none'}. Bind the session per the rules.`
const verdicts = await parallel(args.sessions.map((s) => () =>
  agent(prompt(s), {label:`bind:${s.id}`, model:'haiku', schema:VERDICT})))
const ok = verdicts.filter(Boolean)
log(`${ok.length}/${args.sessions.length} sessions bound`)
return ok
