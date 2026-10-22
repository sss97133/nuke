/**
 * identifierClaims.ts: one reader that turns listing/description text into typed, quoted identifier claims,
 * a canonical body style, a replica flag and a numbers claim. It never writes `vin`; callers land claims in
 * vehicle_identifiers (see migration 20261023000000_vehicle_identifiers.sql) and keep vin for 17-char VINs and
 * legacy chassis values that already passed readBatChassis.
 */
export type IdentifierKind = "chassis" | "engine" | "body_number" | "transmission" | "kardex" | "coa";
export interface IdentifierClaim { kind: IdentifierKind; value: string | null; quote: string; confidence: number; }
export type BodyStyle = "SPEEDSTER" | "CONVERTIBLE_D" | "CABRIOLET" | "ROADSTER" | "HARDTOP" | "COUPE";
export interface IdentifierRead {
  identifiers: IdentifierClaim[];
  body_style: BodyStyle | null; body_style_quote: string | null; body_style_basis: "title" | "rule" | "text" | null;
  is_replica: boolean; replica_quote: string | null;
  numbers_claim: "matching" | "non_matching" | null; numbers_quote: string | null;
  documented_by: Array<"kardex" | "coa">;
}

const NUM = String.raw`['"‘’“”]?([A-Z]{0,3}[0-9][0-9A-Z\-/]{3,15})['"‘’“”]?`;
const LABELS: Array<[IdentifierKind, RegExp]> = [
  ["chassis", new RegExp(String.raw`\b(?:chassis|serial|vin)\s*(?:no\.?|number|num\.?|#)?\s*[:#]?\s*` + NUM, "gi")],
  ["engine", new RegExp(String.raw`\bengine\s*(?:no\.?|number|num\.?|#)\s*[:#]?\s*` + NUM, "gi")],
  ["transmission", new RegExp(String.raw`\b(?:transmission|transaxle|gearbox|trans\.?)\s*(?:no\.?|number|num\.?|#)\s*[:#]?\s*` + NUM, "gi")],
  ["body_number", new RegExp(String.raw`\b(?:body|karmann|reutter|d['’]ieteren|drauz)\s*(?:body\s*)?(?:no\.?|number|num\.?|#|plate)\s*[:#]?\s*` + NUM, "gi")],
];

function quoteAround(text: string, start: number, end: number): string {
  const s = Math.max(0, text.lastIndexOf("\n", start) + 1, start - 80);
  const nl = text.indexOf("\n", end);
  const e = Math.min(text.length, nl === -1 ? end + 80 : Math.min(nl, end + 80));
  return text.slice(s, e).trim();
}

/** Body-style precedence: the listing title, then the chassis rule range (bodyFromRule, e.g. from
 * identifier_rule_for), then the description text. */
export function readIdentifierClaims(text: string | null | undefined, opts: { title?: string | null; bodyFromRule?: BodyStyle | null } = {}): IdentifierRead {
  const t = text ?? "";
  const out: IdentifierRead = { identifiers: [], body_style: null, body_style_quote: null, body_style_basis: null, is_replica: false,
    replica_quote: null, numbers_claim: null, numbers_quote: null, documented_by: [] };
  const seen = new Set<string>();
  for (const [kind, re] of LABELS) {
    for (const m of t.matchAll(re)) {
      const value = m[1].toUpperCase().replace(/[-/]+$/, "");
      if (!/[0-9]/.test(value) || seen.has(kind + value)) continue;
      seen.add(kind + value);
      const strong = /\b(?:no\.?|number|#)/i.test(m[0]);
      out.identifiers.push({ kind, value, quote: quoteAround(t, m.index!, m.index! + m[0].length), confidence: strong ? 0.8 : 0.6 });
    }
  }
  const kardex = /\bkardex\b/i.exec(t);
  if (kardex) { out.documented_by.push("kardex"); out.identifiers.push({ kind: "kardex", value: null, quote: quoteAround(t, kardex.index, kardex.index + 6), confidence: 0.7 }); }
  const coa = /certificate of authenticity|\bCOA\b/.exec(t) ?? /certificate of authenticity/i.exec(t);
  if (coa) { out.documented_by.push("coa"); out.identifiers.push({ kind: "coa", value: null, quote: quoteAround(t, coa.index, coa.index + coa[0].length), confidence: 0.7 }); }
  const nonMatch = /\b(?:non[- ]?matching|not (?:the )?(?:original|matching)[- ]numbers?|replacement engine|period[- ]correct (?:replacement )?engine)\b/i.exec(t);
  const match = /\bmatching[- ]numbers?\b|\b(?:engine|numbers?) (?:and \w+ )?(?:stampings? )?match(?:es|ing)?\b/i.exec(t);
  if (nonMatch) { out.numbers_claim = "non_matching"; out.numbers_quote = quoteAround(t, nonMatch.index, nonMatch.index + nonMatch[0].length); }
  else if (match) { out.numbers_claim = "matching"; out.numbers_quote = quoteAround(t, match.index, match.index + match[0].length); }
  const rep = /\b(?:replica|re-?creation)\b(?!\s+(?:\w+\s+)?(?:wheels?|hubcaps?|caps|seats?|steering|badges?|crests?|mirrors?|bumpers?|tool|radio|license|plates?|knock-?offs?|gauges?|dash|horn|luggage|rack|parts?|top|emblems?|script))|\btribute (?:car|build|edition)\b|\bkit car\b|\bintermeccanica\b|\bvintage speedsters?\b|\bbeck speedster\b|\bchamonix\b|\bspecial motor cars\b/i.exec(t);
  if (rep) { out.is_replica = true; out.replica_quote = quoteAround(t, rep.index, rep.index + rep[0].length); }
  const bodies: Array<[BodyStyle, RegExp]> = [
    ["CONVERTIBLE_D", /\bconvertible[- ]?["“]?D\b["”]?/i], ["SPEEDSTER", /\bspeedster\b/i], ["HARDTOP", /\b(?:karmann )?hard[- ]?top coupe\b|\bkarmann hardtop\b|\bnotchback\b/i],
    ["ROADSTER", /\broadster\b/i], ["CABRIOLET", /\bcabriolet\b|\bcabrio\b/i], ["COUPE", /\bcoup[eé]\b/i],
  ];
  const first = (src: string) => { for (const [bs, re] of bodies) { const m = re.exec(src); if (m) return { bs, m }; } return null; };
  const fromTitle = opts.title ? first(opts.title) : null;
  const fromText = first(t);
  if (fromTitle) { out.body_style = fromTitle.bs; out.body_style_quote = opts.title!.trim(); out.body_style_basis = "title"; }
  else if (opts.bodyFromRule) { out.body_style = opts.bodyFromRule; out.body_style_quote = null; out.body_style_basis = "rule"; }
  else if (fromText) { out.body_style = fromText.bs; out.body_style_quote = quoteAround(t, fromText.m.index!, fromText.m.index! + fromText.m[0].length); out.body_style_basis = "text"; }
  return out;
}
