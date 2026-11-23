// Prerendered /cohort/:make/:model/:year market report. Built only from
// get_make_model_terminal (anon, read-only). Empty blocks are omitted; no
// stand-in numbers.

import type { FacePage } from './discoveryFace';

// Keep these in lockstep with discoveryFace (this module must not import
// values from it — discoveryFace re-exports path helpers from here).
export const SITE = 'https://nuke.ag';

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function cohortMakePath(make: string): string {
  return `/cohort/${encodeURIComponent(make.trim().toLowerCase())}`;
}

export function cohortModelPath(make: string, model: string): string {
  return `/cohort/${encodeURIComponent(make.trim().toLowerCase())}/${encodeURIComponent(model.trim().toLowerCase())}`;
}

/** Stable, lowercase canonical path for a year-make-model page. */
export function cohortPath(make: string, model: string, year: number): string {
  return `${cohortModelPath(make, model)}/${year}`;
}

/** Same visual casing the cohort page applies to route params. */
export function displayToken(s: string): string {
  return s
    .split(/(\s|-)/)
    .map((part) => (/^[a-z]/.test(part) ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join('');
}

export const COHORT_COMP_LIMIT = 10;

type J = Record<string, unknown>;
const obj = (v: unknown): J | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as J) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const dayOf = (iso: string | null) => (iso ? iso.slice(0, 10) : null);
const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

export type CohortComp = {
  vehicle_id: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  sale_price: number | null;
  miles: number | null;
  platform: string | null;
  sold_date: string | null;
  listing_url: string | null;
};

export type CohortPrice = {
  populated: boolean;
  median: number | null;
  p25: number | null;
  p75: number | null;
  min: number | null;
  max: number | null;
  n: number | null;
  observed_at: string | null;
  source: string | null;
  currency: string | null;
};

export type CohortReport = {
  make: string;
  model: string;
  year: number;
  label: string;
  path: string;
  url: string;
  price: CohortPrice;
  comps: CohortComp[];
  latest_sale: string | null;
  computed_on: string | null;
  last_updated: string | null;
  member_count: number | null;
};

function parseComp(row: unknown): CohortComp | null {
  const r = obj(row);
  if (!r) return null;
  const sale = num(r.sale_price);
  const vehicle_id = str(r.vehicle_id);
  if (sale == null && !vehicle_id) return null;
  const year = num(r.year) ?? (typeof r.year === 'string' && /^\d{4}$/.test(r.year) ? Number(r.year) : null);
  return {
    vehicle_id,
    year,
    make: str(r.make),
    model: str(r.model),
    trim: str(r.trim),
    sale_price: sale,
    miles: num(r.miles),
    platform: str(r.platform),
    sold_date: dayOf(str(r.sold_date)),
    listing_url: str(r.listing_url),
  };
}

function parsePrice(terminal: J | null): CohortPrice {
  const pd = obj(terminal?.price_distribution);
  const populated = pd?.populated === true;
  if (!populated) {
    return {
      populated: false,
      median: null, p25: null, p75: null, min: null, max: null,
      n: null, observed_at: null, source: null, currency: null,
    };
  }
  return {
    populated: true,
    median: num(pd?.median),
    p25: num(pd?.p25),
    p75: num(pd?.p75),
    min: num(pd?.min),
    max: num(pd?.max),
    n: num(pd?.n),
    observed_at: dayOf(str(pd?.observed_at)),
    source: str(pd?.source),
    currency: str(pd?.currency) ?? 'USD',
  };
}

export function recentComps(rows: CohortComp[], limit = COHORT_COMP_LIMIT): CohortComp[] {
  const dated = (c: CohortComp) => (c.sold_date && Number.isFinite(Date.parse(c.sold_date)) ? Date.parse(c.sold_date) : null);
  return [...rows].sort((a, b) => {
    const da = dated(a);
    const db = dated(b);
    if (da != null && db != null) return db - da;
    if (da != null) return -1;
    if (db != null) return 1;
    return 0;
  }).slice(0, limit);
}

/** Every dollar amount this report is allowed to print, rounded the same way the face does. */
export function fixtureMoney(report: CohortReport): number[] {
  const out: number[] = [];
  const add = (n: number | null) => { if (n != null) out.push(Math.round(n)); };
  add(report.price.median);
  add(report.price.p25);
  add(report.price.p75);
  add(report.price.min);
  add(report.price.max);
  for (const c of report.comps) add(c.sale_price);
  return out;
}

export function moneyAmounts(text: string): number[] {
  return [...text.matchAll(/\$([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)/g)].map((m) => Number(m[1].replace(/,/g, '')));
}

export function parseCohortTerminal(make: string, model: string, year: number, terminal: unknown): CohortReport {
  const label = `${year} ${displayToken(make)} ${displayToken(model)}`.replace(/\s+/g, ' ').trim();
  const path = cohortPath(make, model, year);
  const payload = obj(terminal);
  const price = parsePrice(payload);
  const rawComps = payload?.comps && obj(payload.comps)?.populated === true
    ? arr(obj(payload.comps)?.rows).map(parseComp).filter((c): c is CohortComp => c != null)
    : [];
  const comps = recentComps(rawComps);
  const latest_sale = comps.map((c) => c.sold_date).find((d): d is string => !!d) ?? null;
  const computed_on = price.observed_at;
  const last_updated = computed_on ?? latest_sale;
  const count = obj(payload?.cohort_count);
  const member_count = count?.populated === true ? num(count.value) : null;
  return {
    make: displayToken(make),
    model: displayToken(model),
    year,
    label,
    path,
    url: `${SITE}${path}`,
    price,
    comps,
    latest_sale,
    computed_on,
    last_updated,
    member_count,
  };
}

export function cohortWorthAnswer(report: CohortReport): string {
  const { label, price, computed_on } = report;
  if (!(price.populated && price.median != null)) {
    return `Nuke does not yet have enough recorded sold prices to state what a ${label} is worth. A median and range appear when sold events for this year, make, and model are on the ledger.`;
  }
  let s = `A ${label} has a median recorded sale price of ${money(price.median)} on Nuke`;
  if (price.n != null) s += ` from ${plural(price.n, 'sold event')}`;
  if (computed_on) s += ` as of ${computed_on}`;
  s += '.';
  if (price.min != null && price.max != null) s += ` The recorded range is ${money(price.min)}–${money(price.max)}.`;
  s += ' Figures are computed from sold prices on Nuke in USD; unsold high bids and unverified or duplicate events are excluded. They are not an appraisal of a specific vehicle.';
  return s;
}

export function cohortJsonLd(report: CohortReport): { '@context': string; '@graph': J[] } {
  const dataset: J = {
    '@type': 'Dataset',
    name: `${report.label} recorded sales`,
    url: report.url,
    description: `Recorded sold prices for the ${report.label} on Nuke.`,
    creator: { '@type': 'Organization', name: 'Nuke', url: SITE },
    isAccessibleForFree: true,
  };
  if (report.last_updated) dataset.dateModified = report.last_updated;
  const measured: J[] = [];
  const measure = (name: string, value: number, unit?: string) => {
    const item: J = { '@type': 'PropertyValue', name, value };
    if (unit) item.unitText = unit;
    measured.push(item);
  };
  const currency = report.price.currency ?? 'USD';
  if (report.price.median != null) measure('median sale price', Math.round(report.price.median), currency);
  if (report.price.min != null) measure('minimum recorded sale price', Math.round(report.price.min), currency);
  if (report.price.max != null) measure('maximum recorded sale price', Math.round(report.price.max), currency);
  if (report.price.n != null) measure('recorded sold events', report.price.n);
  if (measured.length) dataset.variableMeasured = measured;

  const vehicle: J = {
    '@type': 'Vehicle',
    name: report.label,
    url: report.url,
    manufacturer: report.make,
    model: report.model,
    modelDate: String(report.year),
  };

  const faq: J = {
    '@type': 'FAQPage',
    mainEntity: [{
      '@type': 'Question',
      name: `What is a ${report.label} worth?`,
      acceptedAnswer: { '@type': 'Answer', text: cohortWorthAnswer(report) },
    }],
  };

  return { '@context': 'https://schema.org', '@graph': [dataset, vehicle, faq] };
}

function ldScript(value: unknown): string {
  return `<script type="application/ld+json">${JSON.stringify(value).replace(/</g, '\\u003c')}</script>`;
}

function compLabel(c: CohortComp, fallback: string): string {
  const bits = [c.year != null ? String(c.year) : null, c.make, c.model, c.trim].filter((s): s is string => !!s);
  return bits.length ? bits.join(' ') : fallback;
}

function isSafeHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function renderComps(report: CohortReport): string {
  if (!report.comps.length) return '';
  const items = report.comps.map((c) => {
    const parts: string[] = [escapeHtml(compLabel(c, report.label))];
    if (c.sale_price != null) parts.push(escapeHtml(money(c.sale_price)));
    if (c.miles != null) parts.push(escapeHtml(`${Math.round(c.miles).toLocaleString('en-US')} mi`));
    if (c.sold_date) parts.push(escapeHtml(c.sold_date));
    if (c.platform) parts.push(escapeHtml(c.platform));
    const links: string[] = [];
    if (c.listing_url && isSafeHttpUrl(c.listing_url)) {
      links.push(`<a href="${escapeHtml(c.listing_url)}">source</a>`);
    }
    if (c.vehicle_id) {
      links.push(`<a href="${SITE}/vehicle/${escapeHtml(c.vehicle_id)}">on Nuke</a>`);
    }
    return `<li>${parts.join(' · ')}${links.length ? ` — ${links.join(' · ')}` : ''}</li>`;
  });
  return `<section><h2>Recent recorded sales</h2><ul>${items.join('')}</ul></section>`;
}

function renderPrice(report: CohortReport): string {
  const { price, computed_on } = report;
  if (!price.populated) return '';
  const facts: string[] = [];
  if (price.median != null) facts.push(`Median sale ${money(price.median)}`);
  if (price.n != null) facts.push(plural(price.n, 'recorded sale'));
  if (computed_on) facts.push(`Observed ${computed_on}`);
  const lines: string[] = [];
  if (facts.length) lines.push(`<p>${escapeHtml(facts.join(' · '))}.</p>`);
  if (price.min != null && price.max != null) {
    let range = `Recorded range ${money(price.min)}–${money(price.max)}`;
    if (price.p25 != null && price.p75 != null) range += `, middle half ${money(price.p25)}–${money(price.p75)}`;
    lines.push(`<p>${escapeHtml(range)}.</p>`);
  } else if (price.p25 != null && price.p75 != null) {
    lines.push(`<p>${escapeHtml(`Middle half ${money(price.p25)}–${money(price.p75)}`)}.</p>`);
  }
  return lines.length ? `<section><h2>Recorded sale prices</h2>${lines.join('')}</section>` : '';
}

function renderUpdated(report: CohortReport): string {
  const bits: string[] = [];
  if (report.computed_on) bits.push(`Computed ${report.computed_on}`);
  if (report.latest_sale) bits.push(`Latest recorded sale ${report.latest_sale}`);
  if (report.member_count != null) bits.push(`${plural(report.member_count, 'public vehicle')} in this cohort`);
  return bits.length ? `<p>${escapeHtml(bits.join(' · '))}.</p>` : '';
}

export function buildCohortReport(make: string, model: string, year: number, terminal: unknown): FacePage {
  const report = parseCohortTerminal(make, model, year, terminal);
  const { price, label, path } = report;
  const title = price.populated && price.median != null
    ? `${label} value: ${money(price.median)} | Nuke`
    : `${label} | Nuke`;
  const description = price.populated && price.median != null
    ? `${label} median sale ${money(price.median)}${price.n != null ? ` from ${plural(price.n, 'recorded sale')}` : ''} on Nuke${report.computed_on ? ` (as of ${report.computed_on})` : ''}.`
    : `${label} market record on Nuke. A median is shown when enough recorded sales are on the ledger.`;
  const faqQ = `What is a ${label} worth?`;
  const faqA = cohortWorthAnswer(report);
  const makePath = cohortMakePath(make);
  const modelPath = cohortModelPath(make, model);
  const crumbs = `<nav><a href="${SITE}/">Nuke</a> · <a href="${SITE}${makePath}">${escapeHtml(report.make)}</a> · <a href="${SITE}${modelPath}">${escapeHtml(report.model)}</a></nav>`;
  const body =
    `<main><article>` +
    crumbs +
    `<h1>${escapeHtml(label)}</h1>` +
    renderUpdated(report) +
    renderPrice(report) +
    renderComps(report) +
    `<section><h2>${escapeHtml(faqQ)}</h2><p>${escapeHtml(faqA)}</p></section>` +
    `<p>Figures come from recorded sold prices on Nuke, each with a source. <a href="${SITE}${path}">Open the cohort terminal</a>.</p>` +
    `</article></main>`;
  return { title, description, path, type: 'website', body, head: ldScript(cohortJsonLd(report)) };
}
