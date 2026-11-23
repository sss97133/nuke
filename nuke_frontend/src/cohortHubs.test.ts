import { describe, expect, it } from 'vitest';
import { SITE } from './lib/discoveryFace';
import {
  buildCohortHubFace,
  groupProfiles,
  hubSitemapUrls,
  parseCohortHubPath,
  parseYearProfile,
  postgrestIlikeExact,
  yearProfilesQuery,
  type YearProfile,
} from './lib/cohortHubs';

const ROWS: YearProfile[] = [
  { make: 'Chevrolet', model: 'Chevelle', year: 1967, updated_at: '2026-11-20' },
  { make: 'Chevrolet', model: 'Chevelle', year: 1966, updated_at: '2026-11-18' },
  { make: 'Chevrolet', model: 'Camaro', year: 1969, updated_at: '2026-10-01' },
  { make: 'Ford', model: 'Mustang', year: 1966, updated_at: '2026-09-01' },
];

function ld(page: { head?: string }): { '@graph': Array<Record<string, unknown>> } {
  const m = page.head?.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('no json-ld');
  return JSON.parse(m[1]);
}

describe('cohort hubs', () => {
  it('parses index, make, and model paths and ignores year terminals', () => {
    expect(parseCohortHubPath('/cohort')).toEqual({ kind: 'index' });
    expect(parseCohortHubPath('/cohort/')).toEqual({ kind: 'index' });
    expect(parseCohortHubPath('/cohort/Chevrolet')).toEqual({ kind: 'make', make: 'Chevrolet' });
    expect(parseCohortHubPath('/cohort/chevrolet/chevelle')).toEqual({ kind: 'model', make: 'chevrolet', model: 'chevelle' });
    expect(parseCohortHubPath('/cohort/chevrolet/chevelle/1967')).toBeNull();
    expect(parseCohortHubPath('/market')).toBeNull();
  });

  it('groups profiles by make and model and skips incomplete rows', () => {
    expect(parseYearProfile({ canonical_make: 'Ford', canonical_model: 'GT', year: 2005, updated_at: '2026-01-02T00:00:00Z' }))
      .toEqual({ make: 'Ford', model: 'GT', year: 2005, updated_at: '2026-01-02' });
    expect(parseYearProfile({ canonical_make: 'Ford', canonical_model: 'GT' })).toBeNull();
    const grouped = groupProfiles(ROWS);
    expect(grouped.map((g) => g.make)).toEqual(['Chevrolet', 'Ford']);
    expect(grouped[0].models.map((m) => m.model)).toEqual(['Camaro', 'Chevelle']);
    expect(grouped[0].models[1].years.map((y) => y.year)).toEqual([1966, 1967]);
  });

  it('the index lists makes, canonicalizes to /cohort, and invents no prices', () => {
    const page = buildCohortHubFace({ kind: 'index' }, ROWS);
    expect(page.path).toBe('/cohort');
    expect(page.title).toBe('Vehicle cohorts | Nuke');
    expect(page.description).toContain('2 makes');
    expect(page.body).toContain(`href="${SITE}/cohort/chevrolet"`);
    expect(page.body).toContain(`href="${SITE}/cohort/ford"`);
    expect(page.body).toContain('3 year pages');
    expect(page.body).toContain('1 year page');
    expect(page.body).not.toContain('$');
    const graph = ld(page);
    expect(graph['@graph'].map((n) => n['@type'])).toEqual(['CollectionPage', 'ItemList']);
    expect(graph['@graph'][1].numberOfItems).toBe(2);
    expect(graph['@graph'][0].url).toBe(`${SITE}/cohort`);
  });

  it('the make hub lists models and the model hub lists only its years', () => {
    const makePage = buildCohortHubFace({ kind: 'make', make: 'chevrolet' }, ROWS);
    expect(makePage.path).toBe('/cohort/chevrolet');
    expect(makePage.title).toBe('Chevrolet cohorts | Nuke');
    expect(makePage.description).toContain('2 models');
    expect(makePage.body).toContain(`href="${SITE}/cohort/chevrolet/chevelle"`);
    expect(makePage.body).toContain(`href="${SITE}/cohort/chevrolet/camaro"`);
    expect(makePage.body).not.toContain('/ford/');
    expect(makePage.body).not.toContain('$');

    const years = buildCohortHubFace({ kind: 'model', make: 'Chevrolet', model: 'Chevelle' }, ROWS);
    expect(years.path).toBe('/cohort/chevrolet/chevelle');
    expect(years.title).toBe('Chevrolet Chevelle years | Nuke');
    expect(years.body).toContain(`href="${SITE}/cohort/chevrolet/chevelle/1966"`);
    expect(years.body).toContain(`href="${SITE}/cohort/chevrolet/chevelle/1967"`);
    expect(years.body).not.toContain('/1969"');
    expect(years.body).not.toContain('$');
    const yearHrefs = [...years.body.matchAll(/\/cohort\/chevrolet\/chevelle\/(\d{4})/g)].map((m) => Number(m[1])).sort();
    expect(yearHrefs).toEqual([1966, 1967]);
    const graph = ld(years);
    expect(graph['@graph'][1].numberOfItems).toBe(2);
  });

  it('omits lists when no profiles match and does not invent a count', () => {
    const page = buildCohortHubFace({ kind: 'make', make: 'Porsche' }, ROWS);
    expect(page.path).toBe('/cohort/porsche');
    expect(page.body).toContain('No year pages are registered for Porsche yet.');
    expect(page.body).not.toContain('0 models');
    expect(page.description).not.toMatch(/\d+ models/);
    expect(page.body).not.toContain('$');
    expect(ld(page)['@graph'][1].numberOfItems).toBe(0);
  });

  it('sitemap hub URLs are derived from the same year profiles, plus /cohort', () => {
    const locs = hubSitemapUrls(ROWS).map((u) => u.loc).sort();
    expect(locs).toEqual([
      `${SITE}/cohort`,
      `${SITE}/cohort/chevrolet`,
      `${SITE}/cohort/chevrolet/camaro`,
      `${SITE}/cohort/chevrolet/chevelle`,
      `${SITE}/cohort/ford`,
      `${SITE}/cohort/ford/mustang`,
    ].sort());
    expect(hubSitemapUrls(ROWS).find((u) => u.loc === `${SITE}/cohort/chevrolet/chevelle`)?.lastmod).toBe('2026-11-20');
  });

  it('year profile queries stay year-grain and escape like wildcards', () => {
    expect(yearProfilesQuery()).toContain('grain=eq.year');
    expect(yearProfilesQuery()).toContain('year=not.is.null');
    expect(yearProfilesQuery('Chevrolet', 'Chevelle')).toContain('canonical_make=ilike.Chevrolet');
    expect(postgrestIlikeExact('F_150')).toContain('\\_');
  });
});
