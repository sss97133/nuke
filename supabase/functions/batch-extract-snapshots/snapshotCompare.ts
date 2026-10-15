// Agreement between a vehicle row and the house pages of the lots it carries (read-only).
// Used before a hidden vehicle is published: every lot page must name the same car as the row (year, make, model,
// and VIN where both state one), and the lots must name the same car as each other. A vehicle whose lots name
// different cars is a split candidate, never a publish.

export type Identity = { year?: number | null; make?: string | null; model?: string | null; vin?: string | null };
export type LotPage = { event_id: string; url: string; snapshot_id: string | null; page: Identity | null };
export type Verdict = "publish" | "row_disagrees" | "lots_disagree" | "no_page";

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const MAKE_ALIASES: Record<string, string> = { chevy: "chevrolet", mercedes: "mercedesbenz", vw: "volkswagen" };
const makeKey = (s: string | null | undefined) => { const k = norm(s); return MAKE_ALIASES[k] ?? k; };
const vinKey = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Field by field: true agrees, false disagrees, null when either side states nothing. */
export function compareIdentity(a: Identity, b: Identity) {
  const year = a.year && b.year ? a.year === b.year : null;
  const ma = makeKey(a.make), mb = makeKey(b.make);
  const make = ma && mb ? ma === mb || ma.includes(mb) || mb.includes(ma) : null;
  const da = norm(a.model), db = norm(b.model);
  const model = da && db ? da === db || da.includes(db) || db.includes(da) : null;
  const va = vinKey(a.vin), vb = vinKey(b.vin);
  const vin = va.length >= 5 && vb.length >= 5 ? va === vb : null;
  return { year, make, model, vin };
}

const agrees = (c: ReturnType<typeof compareIdentity>) =>
  c.year === true && c.make === true && c.model === true && c.vin !== false;

/** The verdict for one vehicle and the reasons behind it. */
export function judge(row: Identity, lots: LotPage[]): { verdict: Verdict; reasons: string[] } {
  const read = lots.filter(l => l.page && l.page.year && l.page.make && l.page.model);
  if (read.length === 0) return { verdict: "no_page", reasons: ["no lot page with year, make and model"] };
  const reasons: string[] = [];
  for (let i = 0; i < read.length; i++) for (let j = i + 1; j < read.length; j++) {
    const c = compareIdentity(read[i].page!, read[j].page!);
    if (!agrees(c)) reasons.push(`lots ${read[i].url} and ${read[j].url} differ: ${JSON.stringify(c)}`);
  }
  if (reasons.length) return { verdict: "lots_disagree", reasons };
  for (const l of read) {
    const c = compareIdentity(row, l.page!);
    if (!agrees(c)) reasons.push(`row differs from ${l.url}: ${JSON.stringify(c)}`);
  }
  return reasons.length ? { verdict: "row_disagrees", reasons } : { verdict: "publish", reasons: [] };
}

/** The ways a stored listing URL may be spelled in listing_page_snapshots. */
export function urlVariants(url: string): string[] {
  const out = new Set<string>();
  const base = url.replace(/[?#].*$/, "").replace(/\/+$/, "");
  for (const b of [base, base.replace(/^(https?:\/\/)www\./, "$1"), base.replace(/^(https?:\/\/)(?!www\.)/, "$1www.")]) {
    for (const s of [b.replace(/^http:/, "https:"), b.replace(/^https:/, "http:")]) { out.add(s); out.add(s + "/"); }
  }
  return [...out];
}
