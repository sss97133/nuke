// Prerendered /vehicle/:id face. Identity comes from the public vehicles row.
// Recorded sale amounts come only from vehicle_events sold rows that pass the
// same filters as get_make_model_terminal (sold, verified, not duplicate, USD
// or fx_to_usd). vehicles.sale_price and nuke_estimate never appear as prices.
// Empty fields and failed reads are omitted rather than invented.

import type { FacePage } from './discoveryFace';
import {
  SITE,
  escapeHtml,
  cohortPath,
  displayToken,
  parseCohortTerminal,
  recentComps,
  type CohortComp,
  type CohortReport,
} from './cohortReport';

type J = Record<string, unknown>;
const obj = (v: unknown): J | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as J) : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
};
const dayOf = (iso: string | null) => (iso ? iso.slice(0, 10) : null);
const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

export const VEHICLE_SALE_LIMIT = 10;

const REJECTED_VERIFICATION = new Set(['unverified', 'contradicted']);

export type VehicleSale = {
  id: string | null;
  price: number;
  currency: 'USD';
  sold_date: string | null;
  platform: string | null;
  source_url: string | null;
};

export type VehicleIdentity = {
  id: string;
  label: string;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  series: string | null;
  vin: string | null;
  color: string | null;
  interior_color: string | null;
  engine_type: string | null;
  transmission: string | null;
  drivetrain: string | null;
  body_style: string | null;
  mileage: number | null;
  city: string | null;
  state: string | null;
  description: string | null;
  listing_url: string | null;
  primary_image_url: string | null;
  updated_at: string | null;
};

export type VehicleReport = {
  identity: VehicleIdentity;
  path: string;
  url: string;
  sales: VehicleSale[] | null;
  cohort: CohortReport | null;
  comps: CohortComp[];
};

/** Same sold-USD rule as get_make_model_terminal: non-USD only with fx_to_usd. */
export function soldUsd(row: J): number | null {
  const price = num(row.final_price);
  if (price == null || price <= 0) return null;
  const currency = (str(row.currency_code) ?? 'USD').toUpperCase();
  if (currency === 'USD') return price;
  const fx = num(row.fx_to_usd);
  if (fx == null) return null;
  return Math.round(price * fx);
}

export function isSafeHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function parseSoldEvent(row: unknown): VehicleSale | null {
  const r = obj(row);
  if (!r) return null;
  if (str(r.event_status)?.toLowerCase() !== 'sold') return null;
  const verification = str(r.price_verification)?.toLowerCase();
  if (verification && REJECTED_VERIFICATION.has(verification)) return null;
  if (str(r.sale_truth_role)?.toLowerCase() === 'duplicate') return null;
  const price = soldUsd(r);
  if (price == null) return null;
  const sold_date = dayOf(str(r.sold_at) ?? str(r.ended_at));
  const source = str(r.source_url);
  return {
    id: str(r.id),
    price,
    currency: 'USD',
    sold_date,
    platform: str(r.source_platform),
    source_url: source && isSafeHttpUrl(source) ? source : null,
  };
}

export function parseVehicleSales(rows: unknown[] | null): VehicleSale[] | null {
  if (rows == null) return null;
  const sales = rows.map(parseSoldEvent).filter((s): s is VehicleSale => s != null);
  return [...sales].sort((a, b) => {
    const da = a.sold_date && Number.isFinite(Date.parse(a.sold_date)) ? Date.parse(a.sold_date) : null;
    const db = b.sold_date && Number.isFinite(Date.parse(b.sold_date)) ? Date.parse(b.sold_date) : null;
    if (da != null && db != null) return db - da;
    if (da != null) return -1;
    if (db != null) return 1;
    return 0;
  }).slice(0, VEHICLE_SALE_LIMIT);
}

export function parseVehicleIdentity(row: unknown): VehicleIdentity | null {
  const r = obj(row);
  const id = str(r?.id);
  if (!id) return null;
  const year = num(r?.year);
  const make = r?.make != null ? displayToken(String(r.make)) : null;
  const model = r?.model != null ? displayToken(String(r.model)) : null;
  const trim = str(r?.trim);
  const label = [year, make, model, trim].filter((x) => x != null && x !== '').join(' ').replace(/\s+/g, ' ').trim()
    || 'Vehicle';
  const listing = str(r?.listing_url);
  return {
    id,
    label,
    year: year != null && Number.isInteger(year) ? year : year != null ? Math.round(year) : null,
    make,
    model,
    trim,
    series: str(r?.series),
    vin: str(r?.vin),
    color: str(r?.color),
    interior_color: str(r?.interior_color),
    engine_type: str(r?.engine_type),
    transmission: str(r?.transmission),
    drivetrain: str(r?.drivetrain),
    body_style: str(r?.body_style),
    mileage: num(r?.mileage),
    city: str(r?.city),
    state: str(r?.state),
    description: str(r?.description),
    listing_url: listing && isSafeHttpUrl(listing) ? listing : null,
    primary_image_url: str(r?.primary_image_url),
    updated_at: str(r?.updated_at),
  };
}

export function parseVehicleReport(vehicle: unknown, salesRows: unknown[] | null, terminal: unknown): VehicleReport | null {
  const identity = parseVehicleIdentity(vehicle);
  if (!identity) return null;
  const path = `/vehicle/${identity.id}`;
  const sales = parseVehicleSales(salesRows);
  const canCohort = identity.year != null && identity.make && identity.model;
  const cohort = canCohort && terminal != null
    ? parseCohortTerminal(identity.make as string, identity.model as string, identity.year as number, terminal)
    : null;
  const comps = cohort ? recentComps(cohort.comps).filter((c) => c.vehicle_id !== identity.id) : [];
  return { identity, path, url: `${SITE}${path}`, sales, cohort, comps };
}

export function vehicleSaleAnswer(report: VehicleReport): string {
  const { identity, sales } = report;
  if (sales == null) {
    return `The recorded sale history for this ${identity.label} could not be read at this moment. This page does not use the vehicles.sale_price field, which can be a high bid on an unsold lot.`;
  }
  if (!sales.length) {
    return `Nuke does not yet have a recorded sold event for this ${identity.label}. A sale amount appears when a sold, verified vehicle_events row is on the ledger. Asking prices and unsold high bids are not sales.`;
  }
  const last = sales[0];
  let s = `This ${identity.label} has a recorded sale of ${money(last.price)} on Nuke`;
  if (last.sold_date) s += ` on ${last.sold_date}`;
  if (last.platform) s += ` (${last.platform})`;
  s += '.';
  if (sales.length > 1) s += ` ${sales.length.toLocaleString('en-US')} sold events for this vehicle are listed below.`;
  s += ' Amounts are sold prices in USD; unverified, contradicted, and duplicate events and unsold high bids are excluded.';
  return s;
}

export function vehicleWorthAnswer(report: VehicleReport): string {
  const { identity, cohort } = report;
  const label = identity.year && identity.make && identity.model
    ? `${identity.year} ${identity.make} ${identity.model}`
    : identity.label;
  if (!cohort || !(cohort.price.populated && cohort.price.median != null)) {
    return `Nuke does not yet have enough recorded sold prices to state what a ${label} is worth as a cohort. This page is the record of a specific vehicle, not an appraisal.`;
  }
  let s = `The ${label} year cohort has a median recorded sale price of ${money(cohort.price.median)}`;
  if (cohort.price.n != null) s += ` from ${cohort.price.n.toLocaleString('en-US')} sold events`;
  if (cohort.computed_on) s += ` as of ${cohort.computed_on}`;
  s += '. That figure is the cohort, not an appraisal of this vehicle. Condition and equipment are not matched.';
  return s;
}

function ldScript(value: unknown): string {
  return `<script type="application/ld+json">${JSON.stringify(value).replace(/</g, '\\u003c')}</script>`;
}

export function vehicleJsonLd(report: VehicleReport): { '@context': string; '@graph': J[] } {
  const v = report.identity;
  const vehicle: J = {
    '@type': 'Vehicle',
    name: v.label,
    url: report.url,
  };
  if (v.vin) vehicle.vehicleIdentificationNumber = v.vin;
  if (v.year != null) vehicle.modelDate = String(v.year);
  if (v.make) vehicle.manufacturer = v.make;
  if (v.model) vehicle.model = v.model;
  if (v.body_style) vehicle.bodyType = v.body_style;
  if (v.drivetrain) vehicle.driveWheelConfiguration = v.drivetrain;
  if (v.transmission) vehicle.vehicleTransmission = v.transmission;
  if (v.color) vehicle.color = v.color;
  if (v.interior_color) vehicle.vehicleInteriorColor = v.interior_color;
  if (v.mileage != null) {
    vehicle.mileageFromOdometer = { '@type': 'QuantitativeValue', value: v.mileage, unitCode: 'SMI' };
  }
  if (v.primary_image_url && isSafeHttpUrl(v.primary_image_url)) vehicle.image = v.primary_image_url;
  if (v.description) vehicle.description = v.description.slice(0, 1200);
  const faq: J = {
    '@type': 'FAQPage',
    url: report.url,
    mainEntity: [
      {
        '@type': 'Question',
        name: `What did this ${v.label} sell for?`,
        acceptedAnswer: { '@type': 'Answer', text: vehicleSaleAnswer(report) },
      },
      {
        '@type': 'Question',
        name: `What is a ${v.year && v.make && v.model ? `${v.year} ${v.make} ${v.model}` : v.label} worth?`,
        acceptedAnswer: { '@type': 'Answer', text: vehicleWorthAnswer(report) },
      },
    ],
  };
  return { '@context': 'https://schema.org', '@graph': [vehicle, faq] };
}

function factRows(v: VehicleIdentity): [string, string][] {
  const rows: [string, string][] = [];
  if (v.vin) rows.push(['VIN', v.vin]);
  if (v.color) rows.push(['Color', v.color]);
  if (v.interior_color) rows.push(['Interior', v.interior_color]);
  if (v.engine_type) rows.push(['Engine', v.engine_type]);
  if (v.transmission) rows.push(['Transmission', v.transmission]);
  if (v.drivetrain) rows.push(['Drivetrain', v.drivetrain]);
  if (v.body_style) rows.push(['Body', v.body_style]);
  if (v.series) rows.push(['Series', v.series]);
  if (v.mileage != null) rows.push(['Mileage', `${Math.round(v.mileage).toLocaleString('en-US')} miles`]);
  if (v.city && v.state) rows.push(['Location', `${v.city}, ${v.state}`]);
  return rows;
}

function renderSales(report: VehicleReport): string {
  if (report.sales == null) {
    return `<section><h2>Recorded sales of this vehicle</h2><p>The sold-event history could not be read at this moment, so no sale amount is shown. This page does not fall back to vehicles.sale_price.</p></section>`;
  }
  if (!report.sales.length) {
    return `<section><h2>Recorded sales of this vehicle</h2><p>No recorded sold event for this vehicle is on the ledger yet.</p></section>`;
  }
  const items = report.sales.map((s) => {
    const parts: string[] = [escapeHtml(money(s.price))];
    if (s.sold_date) parts.push(escapeHtml(s.sold_date));
    if (s.platform) parts.push(escapeHtml(s.platform));
    const link = s.source_url ? ` — <a href="${escapeHtml(s.source_url)}">source</a>` : '';
    return `<li>${parts.join(' · ')}${link}</li>`;
  });
  return `<section><h2>Recorded sales of this vehicle</h2><ul>${items.join('')}</ul></section>`;
}

function renderComps(report: VehicleReport): string {
  if (!report.comps.length) return '';
  const items = report.comps.slice(0, VEHICLE_SALE_LIMIT).map((c) => {
    const bits = [c.year != null ? String(c.year) : null, c.make, c.model, c.trim].filter((s): s is string => !!s);
    const parts = [escapeHtml(bits.join(' ') || 'Comparable sale')];
    if (c.sale_price != null) parts.push(escapeHtml(money(c.sale_price)));
    if (c.miles != null) parts.push(escapeHtml(`${Math.round(c.miles).toLocaleString('en-US')} mi`));
    if (c.sold_date) parts.push(escapeHtml(c.sold_date));
    if (c.platform) parts.push(escapeHtml(c.platform));
    const links: string[] = [];
    if (c.listing_url && isSafeHttpUrl(c.listing_url)) links.push(`<a href="${escapeHtml(c.listing_url)}">source</a>`);
    if (c.vehicle_id) links.push(`<a href="${SITE}/vehicle/${escapeHtml(c.vehicle_id)}">on Nuke</a>`);
    return `<li>${parts.join(' · ')}${links.length ? ` — ${links.join(' · ')}` : ''}</li>`;
  });
  return `<section><h2>Recent recorded sales in this year, make, and model</h2><ul>${items.join('')}</ul></section>`;
}

function renderCohort(report: VehicleReport): string {
  const { identity, cohort } = report;
  if (!identity.year || !identity.make || !identity.model) return '';
  const path = cohortPath(identity.make, identity.model, identity.year);
  const href = `${SITE}${path}`;
  if (!cohort || !(cohort.price.populated && cohort.price.median != null)) {
    return `<p><a href="${href}">Year cohort page for the ${escapeHtml(String(identity.year))} ${escapeHtml(identity.make)} ${escapeHtml(identity.model)}</a>.</p>`;
  }
  const bits = [`Median sale ${money(cohort.price.median)}`];
  if (cohort.price.n != null) bits.push(`${cohort.price.n.toLocaleString('en-US')} recorded sales`);
  if (cohort.computed_on) bits.push(`Observed ${cohort.computed_on}`);
  return `<section><h2>Year cohort</h2><p>${escapeHtml(bits.join(' · '))}. Condition and equipment are not matched.</p><p><a href="${href}">Open the year cohort page</a>.</p></section>`;
}

export function fixtureMoney(report: VehicleReport): number[] {
  const out: number[] = [];
  const add = (n: number | null | undefined) => { if (n != null) out.push(Math.round(n)); };
  for (const s of report.sales ?? []) add(s.price);
  if (report.cohort) add(report.cohort.price.median);
  for (const c of report.comps) add(c.sale_price);
  return out;
}

export function buildVehicleReport(vehicle: unknown, salesRows: unknown[] | null, terminal: unknown = null): FacePage | null {
  const report = parseVehicleReport(vehicle, salesRows, terminal);
  if (!report) return null;
  const { identity } = report;
  const last = report.sales?.[0];
  const title = `${identity.label} | Nuke`;
  const description = last
    ? `${identity.label} on Nuke. Last recorded sale ${money(last.price)}${last.sold_date ? ` on ${last.sold_date}` : ''}.`
    : `${identity.label} on Nuke. Recorded sale amounts appear when a sold, verified event is on the ledger.`;
  const saleQ = `What did this ${identity.label} sell for?`;
  const worthQ = `What is a ${identity.year && identity.make && identity.model ? `${identity.year} ${identity.make} ${identity.model}` : identity.label} worth?`;
  const rows = factRows(identity);
  const facts = rows.length
    ? `<dl>${rows.map(([k, x]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(x)}</dd>`).join('')}</dl>`
    : '';
  const blurb = identity.description ? `<p>${escapeHtml(identity.description.slice(0, 1200))}</p>` : '';
  const listing = identity.listing_url
    ? `<p><a href="${escapeHtml(identity.listing_url)}">Listing source</a></p>`
    : '';
  const updated = identity.updated_at
    ? `<p>Record last updated ${escapeHtml(dayOf(identity.updated_at) ?? 'unknown')}. This is the record clock, not a sale date.</p>`
    : '';
  const body =
    `<main><article>` +
    `<nav><a href="${SITE}/">Nuke</a>${identity.year && identity.make && identity.model ? ` · <a href="${SITE}${cohortPath(identity.make, identity.model, identity.year)}">Cohort</a>` : ''} · <a href="${SITE}/valuation">Recorded sale prices</a></nav>` +
    `<h1>${escapeHtml(identity.label)}</h1>` +
    facts +
    blurb +
    listing +
    renderSales(report) +
    renderCohort(report) +
    renderComps(report) +
    `<section><h2>${escapeHtml(saleQ)}</h2><p>${escapeHtml(vehicleSaleAnswer(report))}</p></section>` +
    `<section><h2>${escapeHtml(worthQ)}</h2><p>${escapeHtml(vehicleWorthAnswer(report))}</p></section>` +
    updated +
    `<p><a href="${SITE}/api/v1/vehicle/${escapeHtml(identity.id)}">JSON</a> · <a href="${SITE}/methodology">Methodology</a></p>` +
    `</article></main>`;
  const image = identity.primary_image_url && isSafeHttpUrl(identity.primary_image_url)
    ? identity.primary_image_url
    : null;
  return {
    title,
    description,
    path: report.path,
    type: 'website',
    image,
    body,
    head: ldScript(vehicleJsonLd(report)),
  };
}
