/**
 * The market editor's rules (owner, 2026-10-17, from five screenshots of nuke.ag/?tab=market): pure checks over a
 * typed model of what the page says. Each rule is one of his complaints, written so a test and a nightly script can
 * fail on it. `scripts/market-critique.mjs` builds the model from the live readers; the page tests build it from
 * fixtures. A violation carries its numbers so the report never says "wrong" without saying by how much.
 */
import { CALLOUT_MIN_DOLLAR_SHARE, CALLOUT_MIN_SALES_FACTOR, GATE_MIN, type Callout, type Move } from './mapScale';

/** A fact the page states, keyed so two places saying the same thing collide: e.g. `share:Bring a Trailer`. */
export interface Statement { fact: string; where: string }
/** A headline number and the window it covers (`all time`, `last 12 months against the 12 before`), or none. */
export interface Headline { text: string; window: string | null; where: string }
export interface Tile { name: string; usd: number; move: Move }
export interface LiveBoard {
  label: string;
  /** Open lots the board shows for the scope. */
  count: number;
  /** Open lots the Feed shows for the same scope (every source), or null when it could not be read. */
  feedOpenLots: number | null;
  /** The Feed's open lots by source, for the report. */
  feedBySource?: Record<string, number>;
}
export interface PageModel {
  scope: { make?: string | null; family?: string | null; model?: string | null };
  statements: Statement[];
  headlines: Headline[];
  callouts: { items: Callout[]; levelDollars: number; dollarsOf: Record<string, number>; gateMin: number };
  tiles: Tile[];
  sourcesBoard: { label: string } | null;
  liveBoard: LiveBoard | null;
}

export type Rule = 'stated-once' | 'headline-window' | 'callout-floor' | 'scoped-board' | 'unmeasured-largest' | 'live-matches-feed';
export interface Violation { rule: Rule; message: string; numbers: Record<string, number | string> }

export const RULES: Record<Rule, string> = {
  'stated-once': 'Each fact appears once on the page.',
  'headline-window': 'Every headline number carries its window.',
  'callout-floor': 'Callouts clear the dollar and sales floor.',
  'scoped-board': 'A drilled scope never shows an "all makes" board.',
  'unmeasured-largest': 'A tile marked unmeasured must not be the largest tile.',
  'live-matches-feed': "The live board count matches the Feed's open lots for the same scope.",
};

const drilled = (p: PageModel) => !!(p.scope.make || p.scope.family || p.scope.model);
const scopeLabel = (p: PageModel) => [p.scope.make, p.scope.family, p.scope.model].filter(Boolean).join(' · ') || 'all makes';

export function critique(page: PageModel): Violation[] {
  const out: Violation[] = [];

  // 1. Each fact once: the same fact stated in two places (2026-10-17: "Sales by house" at the top repeated the
  //    Sources board's Bring a Trailer share).
  const places = new Map<string, Set<string>>();
  for (const s of page.statements) places.set(s.fact, (places.get(s.fact) ?? new Set()).add(s.where));
  for (const [fact, where] of places) {
    if (where.size > 1) out.push({ rule: 'stated-once', message: `${fact} is stated in ${where.size} places: ${[...where].join(', ')}`, numbers: { fact, places: where.size } });
  }

  // 2. Every headline number carries its window ("334,000 vehicles with a confirmed sale" said nothing about time).
  for (const h of page.headlines) {
    if (/\d/.test(h.text) && !(h.window && h.window.trim())) out.push({ rule: 'headline-window', message: `"${h.text}" (${h.where}) has no window`, numbers: { where: h.where } });
  }

  // 3. Callouts clear the floor: a gain or drop needs twice the sales gate in each window and 0.5% of the level's
  //    window dollars ("Biggest drop: Kawasaki" took prime space on $316K).
  const { items, levelDollars, dollarsOf, gateMin } = page.callouts;
  const minSales = CALLOUT_MIN_SALES_FACTOR * (gateMin || GATE_MIN);
  for (const c of items) {
    if (c.kind === 'largest') continue;
    const usd = dollarsOf[c.name] ?? 0;
    const share = levelDollars > 0 ? usd / levelDollars : 1;
    if (c.sold < minSales || c.prior < minSales || share < CALLOUT_MIN_DOLLAR_SHARE) {
      out.push({ rule: 'callout-floor', message: `${c.kind} ${c.name}: ${c.prior} → ${c.sold} sold, $${Math.round(usd).toLocaleString('en-US')} of $${Math.round(levelDollars).toLocaleString('en-US')} (${(100 * share).toFixed(2)}%); floor is ${minSales} sales each window and ${100 * CALLOUT_MIN_DOLLAR_SHARE}%`, numbers: { name: c.name, sold: c.sold, prior: c.prior, usd, levelDollars, sharePct: Number((100 * share).toFixed(2)) } });
    }
  }

  // 4. A drilled scope never shows an "all makes" board (LEXUS → LC still showed "Sources · ALL MAKES").
  if (drilled(page) && page.sourcesBoard && /all makes/i.test(page.sourcesBoard.label)) {
    out.push({ rule: 'scoped-board', message: `scope ${scopeLabel(page)} shows "${page.sourcesBoard.label}"`, numbers: { scope: scopeLabel(page), label: page.sourcesBoard.label } });
  }

  // 5. The largest tile must not be unmeasured: the eye lands on it first and reads "unmeasured" as the page's verdict.
  const largest = [...page.tiles].sort((a, b) => b.usd - a.usd)[0];
  if (largest && largest.move.kind === 'few' && largest.move.why === 'share') {
    out.push({ rule: 'unmeasured-largest', message: `${largest.name}, the largest tile ($${Math.round(largest.usd).toLocaleString('en-US')}), is "mostly unmeasured houses"`, numbers: { name: largest.name, usd: largest.usd } });
  }

  // 6. The live board's count matches the Feed's open lots for the same scope (LC: "$0 / 0 open lots" while the Feed
  //    had a live LC500).
  const live = page.liveBoard;
  if (live && live.feedOpenLots != null && live.count !== live.feedOpenLots) {
    const by = Object.entries(live.feedBySource ?? {}).map(([k, v]) => `${k} ${v}`).join(', ');
    out.push({ rule: 'live-matches-feed', message: `${live.label}: live board ${live.count} open lot${live.count === 1 ? '' : 's'}, Feed ${live.feedOpenLots}${by ? ` (${by})` : ''}`, numbers: { scope: scopeLabel(page), board: live.count, feed: live.feedOpenLots } });
  }
  return out;
}

/** The report as lines: one per violation with its rule, then the count. */
export function report(violations: Violation[]): string[] {
  const lines = violations.map((v) => `[${v.rule}] ${v.message}`);
  lines.push(violations.length ? `${violations.length} violation${violations.length === 1 ? '' : 's'}` : 'no violations');
  return lines;
}
