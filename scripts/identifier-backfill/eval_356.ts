import { readIdentifierClaims, type BodyStyle } from "/workspace/nuke-vid/supabase/functions/_shared/identifierClaims.ts";
const rows: any[] = JSON.parse(Deno.readTextFileSync("rows.json"));
const sql = Deno.readTextFileSync("/workspace/nuke-vid/supabase/migrations/20261023000100_identifier_rules_porsche_356_seed.sql");
const ranges = [...sql.matchAll(/\('PORSCHE','356','chassis','([^']*)','([A-Z_]+)',(?:'(?:[^']|'')*'|NULL),(\d+),(\d+),'[^']*',(\d+),(\d+),/g)]
  .map((m) => ({ series: m[1], bs: m[2] as BodyStyle, y0: +m[3], y1: +m[4], lo: +m[5], hi: +m[6] }));
const inRange = (v: string | null | undefined) => v && /^\d+$/.test(v) ? ranges.find((r) => +v >= r.lo && +v <= r.hi) : undefined;
const bodyOf = (m: string | null) => { m = (m ?? "").toLowerCase();
  return /convertible\s*["“]?d\b/.test(m) ? "CONVERTIBLE_D" : /speedster/.test(m) ? "SPEEDSTER" : /roadster/.test(m) ? "ROADSTER" : /hard\s*top|notch/.test(m) ? "HARDTOP" : /cabrio/.test(m) ? "CABRIOLET" : /coup/.test(m) ? "COUPE" : null; };
const runId = Deno.args[0] ?? crypto.randomUUID();
const dry: string[] = []; const s: Record<string, number> = { ranges: ranges.length }; const inc = (k: string) => (s[k] = (s[k] ?? 0) + 1);
const byChassis = new Map<string, any[]>();
for (const v of rows) {
  inc("rows");
  const pre = readIdentifierClaims(v.d);
  const vin = (v.vin ?? "").trim();
  const ch = pre.identifiers.filter((c) => c.kind === "chassis").map((c) => c.value!);
  const key = /^\d{4,6}$/.test(vin) ? vin : ch.find((c) => /^\d{4,6}$/.test(c)) ?? null;
  const rule = inRange(key);
  const r = readIdentifierClaims(v.d, { title: v.ttl ?? v.model, bodyFromRule: rule?.bs ?? null });
  const heldOut = readIdentifierClaims(v.d, { bodyFromRule: rule?.bs ?? null }); // no title: rule -> text
  const textOnly = readIdentifierClaims(v.d);
  const gt = bodyOf(v.ttl) ?? bodyOf(v.model);
  const gtRep = /replica|re-?creation|tribute/i.test(`${v.ttl ?? ""} ${v.model ?? ""}`);
  if (gt && !gtRep) { inc("gt_body");
    if (heldOut.body_style) inc("heldout_pred"); if (heldOut.body_style === gt) inc("heldout_tp");
    if (textOnly.body_style) inc("textonly_pred"); if (textOnly.body_style === gt) inc("textonly_tp");
    if (rule) { inc("rule_pred"); if (rule.bs === gt) inc("rule_tp"); } }
  if (r.body_style && !r.is_replica) inc(`body_${r.body_style}_${r.body_style_basis}`); else if (!r.body_style) inc("body_none");
  if (gtRep) { inc("gt_replica"); if (r.is_replica) inc("tp_replica"); }
  if (r.is_replica) inc("replica");
  if (/^\d{4,6}$/.test(vin) && (v.d ?? "").includes(vin)) { inc("gt_chassis"); if (ch.length) inc("pred_chassis_on_labeled"); if (ch.includes(vin)) inc("tp_chassis"); }
  for (const c of r.identifiers) { inc(`claims_${c.kind}`);
    const rr = c.kind === "chassis" ? inRange(c.value) : undefined;
    if (c.kind === "chassis") inc(rr ? "chassis_in_range" : "chassis_out_of_range");
    dry.push(JSON.stringify({ run_id: runId, vehicle_id: v.id, kind: c.kind, value: c.value, quote: c.quote, source_kind: "listing_text", confidence: c.confidence, rule_status: c.kind === "chassis" ? (rr ? "in_range" : "out_of_range") : "unchecked" })); }
  if (r.numbers_claim) inc(`numbers_${r.numbers_claim}`);
  dry.push(JSON.stringify({ run_id: runId, vehicle_id: v.id, label: true, body_style: r.body_style, body_style_basis: r.body_style_basis, body_style_quote: r.body_style_quote, is_replica: r.is_replica, replica_quote: r.replica_quote, numbers_state: r.numbers_claim, numbers_quote: r.numbers_quote, documented_by: r.documented_by }));
  if (key) { if (!byChassis.has(key)) byChassis.set(key, []);
    byChassis.get(key)!.push({ id: v.id, year: v.year, model: v.model, body: r.is_replica ? "REPLICA" : r.body_style, vin: v.vin, sale_price: v.sale_price, from: vin === key ? "vin" : "text" }); }
}
Deno.writeTextFileSync("backfill_dryrun.jsonl", dry.join("\n") + "\n");
const dups = [...byChassis].filter(([, p]) => p.length > 1).map(([chassis, p]) => {
  const rule = inRange(chassis); const years = new Set(p.map((x) => x.year)); const bodies = new Set(p.map((x) => x.body).filter(Boolean));
  const hi = !!rule && p.every((x) => x.year && x.year >= rule.y0 - 1 && x.year <= rule.y1 + 1) && Math.max(...years) - Math.min(...years) <= 1
    && [...bodies].every((b) => b === rule.bs) && !bodies.has("REPLICA");
  return { chassis, rule: rule ? `${rule.series} ${rule.bs} ${rule.lo}-${rule.hi}` : null, high_confidence: hi, profiles: p };
});
Deno.writeTextFileSync("dedup_candidates.json", JSON.stringify(dups, null, 1));
s.dup_groups = dups.length; s.dup_rows = dups.reduce((a, d) => a + d.profiles.length, 0);
s.dup_high_groups = dups.filter((d) => d.high_confidence).length; s.dup_high_rows = dups.filter((d) => d.high_confidence).reduce((a, d) => a + d.profiles.length, 0);
console.log(JSON.stringify({ run_id: runId, ...s }, null, 1));
