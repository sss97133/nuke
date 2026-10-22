import { readIdentifierClaims } from "/workspace/nuke-vid/supabase/functions/_shared/identifierClaims.ts";
const rows: any[] = ["p1","p2","p3"].flatMap((p) => JSON.parse(Deno.readTextFileSync(`${p}.json`)));
const sql = Deno.readTextFileSync("/workspace/nuke-vid/supabase/migrations/20261023000100_identifier_rules_porsche_356_seed.sql");
const ranges = [...sql.matchAll(/\('PORSCHE','356','chassis','([^']*)','([A-Z_]+)',(?:'[^']*(?:''[^']*)*'|NULL),(\d+),(\d+),'[^']*',(\d+),(\d+),/g)].map((m) => ({ series: m[1], bs: m[2], lo: +m[5], hi: +m[6] }));
const inRange = (v: string) => /^\d+$/.test(v) ? ranges.find((r) => +v >= r.lo && +v <= r.hi) : undefined;
const titleBody = (m: string) => { m = (m ?? "").toLowerCase();
  return /convertible\s*"?d\b/.test(m) ? "CONVERTIBLE_D" : /speedster/.test(m) ? "SPEEDSTER" : /roadster/.test(m) ? "ROADSTER" : /hard\s*top|notch/.test(m) ? "HARDTOP" : /cabrio/.test(m) ? "CABRIOLET" : /coup/.test(m) ? "COUPE" : null; };
const runId = crypto.randomUUID();
const dry: string[] = []; const s: Record<string, number> = {};
const inc = (k: string, n = 1) => (s[k] = (s[k] ?? 0) + n);
const byChassis = new Map<string, any[]>();
for (const v of rows) {
  const r = readIdentifierClaims(v.d); inc("rows");
  if (v.d) inc("rows_with_text");
  for (const c of r.identifiers) { inc(`claims_${c.kind}`);
    const rule = c.kind === "chassis" && c.value ? inRange(c.value) : undefined;
    if (c.kind === "chassis" && c.value) inc(rule ? "chassis_in_range" : "chassis_out_of_range");
    dry.push(JSON.stringify({ run_id: runId, vehicle_id: v.id, kind: c.kind, value: c.value, quote: c.quote, source_kind: "listing_text", confidence: c.confidence, rule_status: c.kind === "chassis" ? (rule ? "in_range" : "out_of_range") : "unchecked", rule_series: rule?.series ?? null, rule_body: rule?.bs ?? null }));
  }
  if (r.body_style) inc(`body_${r.body_style}`); if (r.is_replica) inc("replica"); if (r.numbers_claim) inc(`numbers_${r.numbers_claim}`);
  for (const d of r.documented_by) inc(`doc_${d}`);
  dry.push(JSON.stringify({ run_id: runId, vehicle_id: v.id, label: true, body_style: r.body_style, body_style_quote: r.body_style_quote, existing_body: v.bs, is_replica: r.is_replica, replica_quote: r.replica_quote, numbers_state: r.numbers_claim, numbers_quote: r.numbers_quote, documented_by: r.documented_by }));
  // Scorecard: chassis vs existing vin (only where vin is chassis-like AND the number appears in the text = labelable)
  const vin = (v.vin ?? "").trim(); const ch = r.identifiers.filter((c) => c.kind === "chassis").map((c) => c.value);
  if (/^\d{4,6}$/.test(vin) && (v.d ?? "").includes(vin)) { inc("gt_chassis"); if (ch.includes(vin)) inc("tp_chassis"); }
  if (/^\d{4,6}$/.test(vin) && ch.length) { inc("pred_chassis_on_labeled"); if (ch.includes(vin)) inc("pred_chassis_correct"); }
  const tb = titleBody(v.model); const pb = r.is_replica ? null : r.body_style;
  if (tb) { inc("gt_body"); if (pb === tb) inc("tp_body"); if (pb) inc("pred_body_on_labeled"); }
  const key = /^\d{4,6}$/.test(vin) ? vin : ch.find((c) => /^\d{4,6}$/.test(c!)) ?? null;
  if (key) { if (!byChassis.has(key)) byChassis.set(key, []); byChassis.get(key)!.push({ id: v.id, year: v.year, model: v.model, vin: v.vin, sale_price: v.sale_price, from: vin === key ? "vin" : "text" }); }
}
Deno.writeTextFileSync("backfill_dryrun.jsonl", dry.join("\n") + "\n");
const dups = [...byChassis].filter(([, v]) => v.length > 1).map(([chassis, v]) => ({ chassis, rule: inRange(chassis) ?? null, profiles: v }));
Deno.writeTextFileSync("dedup_candidates.json", JSON.stringify(dups, null, 1));
s.dup_groups = dups.length; s.dup_rows = dups.reduce((a, d) => a + d.profiles.length, 0);
console.log(JSON.stringify({ run_id: runId, ...s }, null, 1));
