// Ranking for find_asset text queries. PostgREST returns ilike matches in
// arbitrary order, so "1990 BMW E30 M3" surfaced seat sets and wheels above
// the cars. Rank in JS: exact year/make/model first, parts/memorabilia last,
// then completeness (price, image, a real http listing URL).

const PART_WORDS =
  /\b(seats?|wheels?|rims?|parts?|engine|motor|transmission|gearbox|manual|brochure|poster|model\s*car|diecast|scale|1:\d+|toy|badge|emblem|hood|bumper|door|steering\s*wheel|headlights?|taillights?|exhaust|literature|sign|kit)\b/i;

export type RankableRow = Record<string, unknown>;

function norm(s: unknown): string {
  return String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function looksLikePart(row: RankableRow): boolean {
  return PART_WORDS.test(`${row.model ?? ""} ${row.trim ?? ""}`);
}

/** Higher is better. Exported for tests. */
export function findRankScore(row: RankableRow, tokens: string[], year: number | null): number {
  let score = 0;
  const make = norm(row.make);
  const model = norm(row.model);
  const hay = `${make} ${model}`.trim();
  const toks = tokens.map(norm).filter(Boolean);
  if (year != null && Number(row.year) === year) score += 40;
  if (toks.length) {
    const modelToks = toks.filter((t) => !make.split(" ").includes(t));
    const want = modelToks.join(" ");
    if (want && (model === want || model.startsWith(want + " ") || model.endsWith(" " + want))) score += 50;
    else if (want && model.includes(want)) score += 30;
    // Every token present as a whole word.
    const words = new Set(hay.split(" "));
    if (toks.every((t) => words.has(t))) score += 20;
    // Penalise extra model words beyond the query (variants/parts drift).
    const extra = model.split(" ").filter((w) => w && !toks.includes(w)).length;
    score -= Math.min(extra, 5) * 2;
  }
  if (looksLikePart(row)) score -= 100;
  if (row.sale_price != null && Number(row.sale_price) > 0) score += 6;
  if (row.primary_image_url) score += 4;
  const url = String(row.listing_url || row.bat_auction_url || "");
  if (/^https?:\/\//i.test(url)) score += 4;
  return score;
}

export function rankFindResults<T extends RankableRow>(rows: T[], tokens: string[], year: number | null): T[] {
  return rows
    .map((r, i) => ({ r, i, s: findRankScore(r, tokens, year) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.r);
}
