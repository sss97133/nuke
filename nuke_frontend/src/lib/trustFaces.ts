// Prerendered /methodology, /about, and /sources faces.
// Numbers appear only from parseEvidence (daily /evidence.md) or market_sources_read.
// Empty or failed reads omit figures; they do not fall back to typed counts.

import { SITE, escapeHtml, type FacePage } from './discoveryFace';
import type { Evidence } from '../pages/aboutEvidence';

function ldScript(value: unknown): string {
  return `<script type="application/ld+json">${JSON.stringify(value).replace(/</g, '\\u003c')}</script>`;
}

function faqPage(url: string, name: string, description: string, faqs: { q: string; a: string }[], extra?: Record<string, unknown>): unknown {
  const graph: Record<string, unknown>[] = [
    { '@type': 'WebPage', name, url, description, isPartOf: { '@type': 'WebSite', name: 'Nuke', url: SITE }, ...extra },
    {
      '@type': 'FAQPage',
      url,
      mainEntity: faqs.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    },
  ];
  return { '@context': 'https://schema.org', '@graph': graph };
}

const crumbs = (parts: { label: string; href: string }[]) =>
  `<nav>${parts.map((p) => `<a href="${escapeHtml(p.href)}">${escapeHtml(p.label)}</a>`).join(' · ')}</nav>`;

export const POSITIONING_URL = 'https://github.com/sss97133/nuke/blob/main/docs/POSITIONING.md';
export const EVIDENCE_URL = `${SITE}/evidence.md`;

export const METHODOLOGY_FAQS: { q: string; a: string }[] = [
  {
    q: 'Where do Nuke’s numbers come from?',
    a: 'Every observation about an asset (a bid, a comment, a photograph, a receipt, a title transfer) is kept as an append-only row with its source, its event time, its ingest time, and its trust. State, cohort baselines, and predictions are computed from that log point-in-time, so a number can be replayed from only what was known at the moment it was made. This is the voice of docs/POSITIONING.md, which the About page also uses.',
  },
  {
    q: 'How are citations and confidence represented?',
    a: 'On the Asset Advisor, every claim carries a value or “not recorded”, a confidence (0..1 when known, or null), a confidence_basis (claim_score, consensus, source_trust, estimate_model, or none), and citations. A citation keeps source_name, source_url, observation_id, event_time (the real-world event, never the scrape clock), ingested_at, and is_superseded. Advisor instructions say to cite source_url and event_time when present, never treat ingested_at as the event date, and never invent a missing value. A “not recorded” claim must have null confidence. Those rules live in supabase/functions/mcp-connector/advisor/evidence.ts.',
  },
  {
    q: 'Why is advisor confidence capped?',
    a: 'The advisor catalog instructions in supabase/functions/mcp-connector/advisor/tools.ts say: asking prices are not sales, and confidence is capped at 0.6 until a published sale backtest justifies more.',
  },
  {
    q: 'How are recorded sale prices computed on /valuation and cohort pages?',
    a: 'The /valuation page calls valuation_by_ymm against recorded Bring a Trailer sold-result snapshots. Published winning bids exclude buyer fees, taxes, and transport (BaT policy). Amounts stay in the original currency, without inflation or exchange-rate adjustment, and condition and equipment are not matched. The /cohort year terminal (get_make_model_terminal) uses sold events only, reports prices in USD (non-USD only when fx_to_usd is present), and leaves out unverified, contradicted, and duplicate events and unsold high bids.',
  },
];

export function methodologyFace(): FacePage {
  const path = '/methodology';
  const url = `${SITE}${path}`;
  const title = 'Methodology | Nuke';
  const description =
    'How Nuke cites sources, clocks, and confidence: append-only observations, point-in-time replay, advisor confidence capped at 0.6 until a published sale backtest, and recorded-sale rules for valuation and cohorts.';
  const faqs = METHODOLOGY_FAQS;
  const body =
    `<main><article>` +
    crumbs([{ label: 'Nuke', href: `${SITE}/` }, { label: 'About', href: `${SITE}/about` }]) +
    `<h1>Methodology</h1>` +
    `<p>Nuke is an observational ledger for physical assets, with its predictions graded in the open. The positioning document and the About page state the same rule: every number should carry its source, its date, its unit, and its denominator.</p>` +
    `<section><h2>Data origin</h2>` +
    `<p>Each observation is an append-only row with a source, an event time, an ingest time, and a trust. Vehicles are the first asset class. Language and vision models are sensors, never sources: a model may turn a comment into an attributed claim or a photograph into a condition observation, and that output lands as a row with provenance. It does not produce the number.</p>` +
    `<p>The daily grading table is measured from the live database by <code>scripts/data/readme-stats.mjs</code> and published at <a href="${EVIDENCE_URL}">/evidence.md</a> and on <a href="${SITE}/about">About</a>. This page does not copy a stale count from an older draft.</p>` +
    `<p>Source: <a href="${POSITIONING_URL}">docs/POSITIONING.md</a>.</p></section>` +
    `<section><h2>Citations and clocks</h2>` +
    `<p>Advisor citations separate <code>event_time</code> (when the sale or auction ended) from <code>ingested_at</code> (when Nuke learned it). A missing value is reported as not recorded, with <code>checked_sources</code> when present, rather than a stand-in number.</p></section>` +
    `<section><h2>Confidence scores</h2>` +
    `<p>Advisor claims include <code>confidence</code> and <code>confidence_basis</code>. The catalog caps confidence at 0.6 until a published sale backtest justifies more. Unrecorded fields use null confidence.</p></section>` +
    `<section><h2>Recorded sale evidence</h2>` +
    `<p>Cohort medians on year pages and the <a href="${SITE}/valuation">valuation tool</a> are computed from recorded sold prices, not asking prices or unsold high bids. Details are on those pages and in <code>valuation_by_ymm</code> / <code>get_make_model_terminal</code>.</p></section>` +
    `<p><a href="${SITE}/sources">Sources board</a> · <a href="${SITE}/about">About</a> · <a href="${SITE}/mcp-advisor">Asset Advisor</a> · <a href="${SITE}/api/docs">API docs</a></p>` +
    faqs.map((f) => `<section><h2>${escapeHtml(f.q)}</h2><p>${escapeHtml(f.a)}</p></section>`).join('') +
    `</article></main>`;
  return { title, description, path, type: 'website', body, head: ldScript(faqPage(url, 'Nuke methodology', description, faqs)) };
}

export const ABOUT_FAQS: { q: string; a: string }[] = [
  {
    q: 'What is Nuke?',
    a: 'Nuke is a data machine for physical assets: an observational ledger. Every observation about an asset is kept with its source, its clocks, and its trust. The system computes the asset’s state, its cohort baseline, and its predictions from that log, point-in-time, so every number can be replayed and graded. Vehicles are the first asset class. This is the same voice as the About page and docs/POSITIONING.md.',
  },
  {
    q: 'What is Nuke not?',
    a: 'Not a price guide: the number a buyer gets today from a guide often arrives with no error table; here every number is supposed to carry its source, date, unit, and denominator, and predictions are graded against the outcome in a public table. Not a marketplace: nothing is listed or sold on Nuke; venues are sources, and a sale is one more observation. Not a model’s opinion: language and vision models are sensors, never sources.',
  },
];

function renderEvidence(evidence: Evidence): string {
  const head = evidence.columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('');
  const rows = evidence.models.map((m) => `<tr>${m.cells.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('');
  const notes = evidence.notes.map((n) => `<li>${n.title ? `<strong>${escapeHtml(n.title)}.</strong> ` : ''}${escapeHtml(n.text)}</li>`).join('');
  const when = evidence.measuredAt ? evidence.measuredAt.replace('T', ' ').replace(/:00Z$/, ' UTC') : null;
  return `<section><h2>What you can check</h2>` +
    (when ? `<p>Measured ${escapeHtml(when)}.</p>` : '') +
    `<p>${escapeHtml(evidence.preface)}</p>` +
    `<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>` +
    (notes ? `<ul>${notes}</ul>` : '') +
    `</section>`;
}

export function aboutFace(evidence: Evidence | null): FacePage {
  const path = '/about';
  const url = `${SITE}${path}`;
  const title = 'About | Nuke';
  const description =
    'Nuke is an observational ledger for physical assets, with its predictions graded in the open. Vehicles are the first asset class. The public grading table is measured daily from the live database.';
  const faqs = ABOUT_FAQS;
  const grades = evidence
    ? renderEvidence(evidence)
    : `<section><h2>What you can check</h2><p>The grading table could not be read here. It is the evidence block published at <a href="${EVIDENCE_URL}">/evidence.md</a>, rewritten every morning from the live database by scripts/data/readme-stats.mjs. This page does not fall back to a typed number.</p></section>`;
  const body =
    `<main><article>` +
    crumbs([{ label: 'Nuke', href: `${SITE}/` }, { label: 'Methodology', href: `${SITE}/methodology` }]) +
    `<h1>Nuke</h1>` +
    `<p>An observational ledger for physical assets, with its predictions graded in the open. Pre-launch; vehicles are the first asset class.</p>` +
    `<section><h2>What Nuke is</h2><p>Every observation about an asset (a bid, a comment, a photo, a receipt, a title transfer) is kept with its source, its clocks, and its trust. The system computes the asset’s state, its cohort baseline, and its predictions from that log, point-in-time, so every number can be replayed and graded.</p></section>` +
    grades +
    `<section><h2>What it is not</h2><p>Not a price guide. Not a marketplace: nothing is listed or sold here; the venues are sources, and a sale is one more observation. Not a model’s opinion: a language or vision model is a sensor, never a source.</p></section>` +
    `<p><a href="${SITE}/methodology">Methodology</a> · <a href="${SITE}/sources">Sources</a> · <a href="${EVIDENCE_URL}">evidence.md</a> · <a href="${POSITIONING_URL}">POSITIONING.md</a> · <a href="https://github.com/sss97133/nuke">Repository</a></p>` +
    faqs.map((f) => `<section><h2>${escapeHtml(f.q)}</h2><p>${escapeHtml(f.a)}</p></section>`).join('') +
    `</article></main>`;
  return { title, description, path, type: 'website', body, head: ldScript(faqPage(url, 'About Nuke', description, faqs)) };
}

export type SourceBoardLine = {
  name: string;
  category: string | null;
  held: number | null;
  heldAt: string | null;
  population: number | null;
  method: string | null;
  confidence: number | null;
  populationAt: string | null;
};

export type SourceBoard = { asOf: string; lines: SourceBoardLine[] };

function sourceSentence(l: SourceBoardLine): string {
  const day = (iso: string | null) => (iso ? iso.slice(0, 10) : 'unknown');
  const fmt = (n: number | null) => (n == null ? 'unknown' : n.toLocaleString('en-US'));
  const held = `${fmt(l.held)} lots held (counted ${day(l.heldAt)})`;
  const pop = l.population == null
    ? 'source total unknown'
    : `source total ${fmt(l.population)} (${l.method ?? 'method not recorded'}, confidence ${l.confidence ?? 'not recorded'}, ${day(l.populationAt)})`;
  return `${l.name}: ${held}; ${pop}.`;
}

export const SOURCES_FAQS: { q: string; a: string }[] = [
  {
    q: 'How does Nuke rank sources?',
    a: 'The /sources board and /market face both use the market_sources_read reader. Sources are ranked by the lots Nuke holds for them. Each held count carries the time it was measured. A source total, when known, carries its method, confidence, and date. No source name is hardcoded in the board; names and counts come from the reader.',
  },
];

export function sourcesFace(board: SourceBoard | null): FacePage {
  const path = '/sources';
  const url = `${SITE}${path}`;
  const title = 'Sources | Nuke';
  const description = board
    ? `Every source on Nuke with the same measures, ranked by lots held, read ${board.asOf.slice(0, 10)}.`
    : 'Every source on Nuke with the same measures, ranked by lots held. Counts come from market_sources_read and are omitted when that reader cannot be reached.';
  const list = board && board.lines.length
    ? `<section><h2>Sources, ranked by lots held (read ${escapeHtml(board.asOf.slice(0, 10))})</h2><ol>${
      board.lines.slice(0, 25).map((l) => `<li>${escapeHtml(sourceSentence(l))}</li>`).join('')
    }</ol>${board.lines.length > 25 ? `<p>The first 25 of ${board.lines.length} sources are listed here. Open the board in a browser for the rest.</p>` : ''}</section>`
    : `<section><h2>Sources</h2><p>The live source counts could not be read at this moment, so none are shown here. Open the page in a browser for the board, or see <a href="${SITE}/market">/market</a>.</p></section>`;
  const faqs = SOURCES_FAQS;
  const body =
    `<main><article>` +
    crumbs([{ label: 'Nuke', href: `${SITE}/` }, { label: 'Market', href: `${SITE}/market` }]) +
    `<h1>Sources</h1>` +
    `<p>Every source is shown with the same measures and ranked by the lots Nuke holds for it. Held counts carry the time their fold was measured. Population figures, when present, carry a method, a confidence, and a date. The reader is <code>market_sources_read</code>, the same contract as the Sources board page.</p>` +
    list +
    `<p><a href="${SITE}/sources">Open the sources board</a> · <a href="${SITE}/market">Market</a> · <a href="${SITE}/methodology">Methodology</a></p>` +
    faqs.map((f) => `<section><h2>${escapeHtml(f.q)}</h2><p>${escapeHtml(f.a)}</p></section>`).join('') +
    `</article></main>`;
  return { title, description, path, type: 'website', body, head: ldScript(faqPage(url, 'Nuke sources', description, faqs)) };
}

export function trustFace(pathname: string, opts: { evidence?: Evidence | null; board?: SourceBoard | null } = {}): FacePage | null {
  const path = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;
  if (path === '/methodology') return methodologyFace();
  if (path === '/about') return aboutFace(opts.evidence === undefined ? null : opts.evidence);
  if (path === '/sources') return sourcesFace(opts.board === undefined ? null : opts.board);
  return null;
}
