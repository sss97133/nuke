// Prerendered /cohort, /cohort/:make, and /cohort/:make/:model hubs.
// Built only from year-grain make_model_profiles rows. No prices, no invented counts.

import type { FacePage, SitemapUrl } from './discoveryFace';
import { SITE, cohortMakePath, cohortModelPath, cohortPath, displayToken, escapeHtml } from './cohortReport';

type J = Record<string, unknown>;
const obj = (v: unknown): J | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as J) : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const dayOf = (iso: string | null) => (iso ? iso.slice(0, 10) : null);
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

export type YearProfile = {
  make: string;
  model: string;
  year: number;
  updated_at: string | null;
};

export type CohortHubPath =
  | { kind: 'index' }
  | { kind: 'make'; make: string }
  | { kind: 'model'; make: string; model: string };

export function parseCohortHubPath(pathname: string): CohortHubPath | null {
  const path = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;
  if (path === '/cohort') return { kind: 'index' };
  const parts = path.split('/');
  if (parts[1] !== 'cohort') return null;
  const decode = (s: string): string | null => {
    try {
      const v = decodeURIComponent(s).trim();
      return v || null;
    } catch {
      return null;
    }
  };
  if (parts.length === 3) {
    const make = decode(parts[2]);
    return make ? { kind: 'make', make } : null;
  }
  if (parts.length === 4) {
    const make = decode(parts[2]);
    const model = decode(parts[3]);
    return make && model ? { kind: 'model', make, model } : null;
  }
  return null;
}

export function parseYearProfile(row: unknown): YearProfile | null {
  const r = obj(row);
  if (!r) return null;
  const make = str(r.canonical_make);
  const model = str(r.canonical_model);
  const year = num(r.year) ?? (typeof r.year === 'string' && /^\d{4}$/.test(r.year) ? Number(r.year) : null);
  if (!make || !model || year == null || !Number.isInteger(year) || year < 1885 || year > 2100) return null;
  return { make, model, year, updated_at: dayOf(str(r.updated_at)) };
}

export function profilesForMake(rows: YearProfile[], make: string): YearProfile[] {
  const key = make.trim().toLowerCase();
  return rows.filter((r) => r.make.toLowerCase() === key);
}

export function profilesForModel(rows: YearProfile[], make: string, model: string): YearProfile[] {
  const modelKey = model.trim().toLowerCase();
  return profilesForMake(rows, make).filter((r) => r.model.toLowerCase() === modelKey);
}

export type MakeGroup = { make: string; models: ModelGroup[] };
export type ModelGroup = { make: string; model: string; years: YearProfile[] };

export function groupProfiles(rows: YearProfile[]): MakeGroup[] {
  const makes = new Map<string, Map<string, YearProfile[]>>();
  for (const row of rows) {
    const mk = row.make.toLowerCase();
    const md = row.model.toLowerCase();
    if (!makes.has(mk)) makes.set(mk, new Map());
    const models = makes.get(mk)!;
    if (!models.has(md)) models.set(md, []);
    models.get(md)!.push(row);
  }
  const out: MakeGroup[] = [];
  for (const models of makes.values()) {
    const modelGroups: ModelGroup[] = [];
    for (const years of models.values()) {
      years.sort((a, b) => a.year - b.year);
      modelGroups.push({ make: years[0].make, model: years[0].model, years });
    }
    modelGroups.sort((a, b) => a.model.localeCompare(b.model));
    out.push({ make: modelGroups[0].make, models: modelGroups });
  }
  out.sort((a, b) => a.make.localeCompare(b.make));
  return out;
}

export function hubSitemapUrls(rows: YearProfile[]): SitemapUrl[] {
  const locs: SitemapUrl[] = [{ loc: `${SITE}/cohort` }];
  const seenMake = new Set<string>();
  const seenModel = new Set<string>();
  const makeLast = new Map<string, string>();
  const modelLast = new Map<string, string>();
  for (const row of rows) {
    const makePath = `${SITE}${cohortMakePath(row.make)}`;
    const modelPath = `${SITE}${cohortModelPath(row.make, row.model)}`;
    if (row.updated_at) {
      const prevM = makeLast.get(makePath);
      if (!prevM || row.updated_at > prevM) makeLast.set(makePath, row.updated_at);
      const prevD = modelLast.get(modelPath);
      if (!prevD || row.updated_at > prevD) modelLast.set(modelPath, row.updated_at);
    }
    if (!seenMake.has(makePath)) {
      seenMake.add(makePath);
      locs.push({ loc: makePath, lastmod: makeLast.get(makePath) ?? null });
    }
    if (!seenModel.has(modelPath)) {
      seenModel.add(modelPath);
      locs.push({ loc: modelPath, lastmod: modelLast.get(modelPath) ?? null });
    }
  }
  // lastmod may have been unknown when the loc was first pushed; refresh it.
  return locs.map((u) => {
    if (u.loc === `${SITE}/cohort`) return u;
    const last = makeLast.get(u.loc) ?? modelLast.get(u.loc) ?? u.lastmod;
    return { loc: u.loc, lastmod: last ?? null };
  });
}

/** PostgREST path for year-grain profiles. Filters are exact case-insensitive matches, wildcards escaped. */
export function yearProfilesQuery(make?: string, model?: string): string {
  let q = 'make_model_profiles?grain=eq.year&year=not.is.null&select=canonical_make,canonical_model,year,updated_at&order=canonical_make.asc,canonical_model.asc,year.asc';
  if (make) q += `&canonical_make=ilike.${postgrestIlikeExact(make)}`;
  if (model) q += `&canonical_model=ilike.${postgrestIlikeExact(model)}`;
  return q;
}

export function postgrestIlikeExact(raw: string): string {
  const escaped = raw.trim().replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_').replace(/\*/g, '\\*');
  if (/[^A-Za-z0-9-]/.test(escaped)) return `"${escaped.replace(/"/g, '\\"')}"`;
  return escaped;
}

function ldScript(value: unknown): string {
  return `<script type="application/ld+json">${JSON.stringify(value).replace(/</g, '\\u003c')}</script>`;
}

function itemListLd(name: string, url: string, description: string, items: { name: string; url: string }[]): unknown {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage',
        name,
        url,
        description,
      },
      {
        '@type': 'ItemList',
        name,
        url,
        numberOfItems: items.length,
        itemListElement: items.map((item, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          name: item.name,
          url: item.url,
        })),
      },
    ],
  };
}

function crumbs(parts: { label: string; href: string }[]): string {
  return `<nav>${parts.map((p) => `<a href="${escapeHtml(p.href)}">${escapeHtml(p.label)}</a>`).join(' · ')}</nav>`;
}

export function buildCohortIndexFace(rows: YearProfile[]): FacePage {
  const groups = groupProfiles(rows);
  const makeCount = groups.length;
  const title = 'Vehicle cohorts | Nuke';
  const description = makeCount
    ? `Year, make, and model market records on Nuke, from ${plural(makeCount, 'make')}.`
    : 'Year, make, and model market records on Nuke. Makes appear here when a year page is registered.';
  const items = groups.map((g) => ({
    name: displayToken(g.make),
    url: `${SITE}${cohortMakePath(g.make)}`,
  }));
  const list = groups.length
    ? `<section><h2>Makes</h2><ul>${groups.map((g) => {
      const n = g.models.reduce((sum, m) => sum + m.years.length, 0);
      return `<li><a href="${SITE}${cohortMakePath(g.make)}">${escapeHtml(displayToken(g.make))}</a> · ${escapeHtml(plural(n, 'year page'))}</li>`;
    }).join('')}</ul></section>`
    : '<p>No year pages are registered yet.</p>';
  const body = `<main><article>${crumbs([{ label: 'Nuke', href: `${SITE}/` }])}<h1>Vehicle cohorts</h1><p>${escapeHtml(description)}</p>${list}</article></main>`;
  return { title, description, path: '/cohort', type: 'website', body, head: ldScript(itemListLd('Vehicle cohorts', `${SITE}/cohort`, description, items)) };
}

export function buildMakeHubFace(make: string, rows: YearProfile[]): FacePage {
  const label = displayToken(make);
  const groups = groupProfiles(profilesForMake(rows, make));
  const models = groups[0]?.models ?? [];
  const path = cohortMakePath(make);
  const title = `${label} cohorts | Nuke`;
  const description = models.length
    ? `${label} models on Nuke, ${plural(models.length, 'model')} with year pages.`
    : `${label} market records on Nuke. Models appear here when a year page is registered.`;
  const items = models.map((m) => ({
    name: `${label} ${displayToken(m.model)}`,
    url: `${SITE}${cohortModelPath(m.make, m.model)}`,
  }));
  const list = models.length
    ? `<section><h2>Models</h2><ul>${models.map((m) =>
      `<li><a href="${SITE}${cohortModelPath(m.make, m.model)}">${escapeHtml(displayToken(m.model))}</a> · ${escapeHtml(plural(m.years.length, 'year page'))}</li>`).join('')}</ul></section>`
    : `<p>No year pages are registered for ${escapeHtml(label)} yet.</p>`;
  const body = `<main><article>${crumbs([{ label: 'Nuke', href: `${SITE}/` }, { label: 'Cohorts', href: `${SITE}/cohort` }])}<h1>${escapeHtml(label)}</h1><p>${escapeHtml(description)}</p>${list}</article></main>`;
  return { title, description, path, type: 'website', body, head: ldScript(itemListLd(`${label} cohorts`, `${SITE}${path}`, description, items)) };
}

export function buildModelHubFace(make: string, model: string, rows: YearProfile[]): FacePage {
  const makeLabel = displayToken(make);
  const modelLabel = displayToken(model);
  const label = `${makeLabel} ${modelLabel}`;
  const years = profilesForModel(rows, make, model).slice().sort((a, b) => a.year - b.year);
  const path = cohortModelPath(make, model);
  const title = `${label} years | Nuke`;
  const description = years.length
    ? `${label} year pages on Nuke, ${plural(years.length, 'year')}.`
    : `${label} market records on Nuke. Year pages appear here when they are registered.`;
  const items = years.map((y) => ({
    name: `${y.year} ${label}`,
    url: `${SITE}${cohortPath(y.make, y.model, y.year)}`,
  }));
  const list = years.length
    ? `<section><h2>Years</h2><ul>${years.map((y) =>
      `<li><a href="${SITE}${cohortPath(y.make, y.model, y.year)}">${y.year}</a></li>`).join('')}</ul></section>`
    : `<p>No year pages are registered for ${escapeHtml(label)} yet.</p>`;
  const body = `<main><article>${crumbs([
    { label: 'Nuke', href: `${SITE}/` },
    { label: 'Cohorts', href: `${SITE}/cohort` },
    { label: makeLabel, href: `${SITE}${cohortMakePath(make)}` },
  ])}<h1>${escapeHtml(label)}</h1><p>${escapeHtml(description)}</p>${list}</article></main>`;
  return { title, description, path, type: 'website', body, head: ldScript(itemListLd(`${label} years`, `${SITE}${path}`, description, items)) };
}

export function buildCohortHubFace(hub: CohortHubPath, rows: YearProfile[]): FacePage {
  if (hub.kind === 'index') return buildCohortIndexFace(rows);
  if (hub.kind === 'make') return buildMakeHubFace(hub.make, rows);
  return buildModelHubFace(hub.make, hub.model, rows);
}

export function hubCountsInText(text: string): number[] {
  return [...text.matchAll(/\b(\d{1,6})\b/g)].map((m) => Number(m[1]));
}
