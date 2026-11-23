import { describe, expect, it } from 'vitest';
import { SITE } from './lib/discoveryFace';
import {
  SITE as REPORT_SITE,
  buildCohortReport,
  cohortJsonLd,
  cohortWorthAnswer,
  fixtureMoney,
  moneyAmounts,
  parseCohortTerminal,
  recentComps,
  type CohortComp,
} from './lib/cohortReport';

const VEH1 = '11111111-1111-4111-8111-111111111111';
const VEH2 = '22222222-2222-4222-8222-222222222222';
const VEH3 = '33333333-3333-4333-8333-333333333333';

const TERMINAL = {
  resolved: true,
  cohort_count: { populated: true, value: 80, source: 'cohort_members' },
  price_distribution: {
    populated: true,
    median: 57208,
    p25: 41000,
    p75: 70000,
    min: 12000,
    max: 90000,
    n: 105,
    observed_at: '2026-11-20T00:00:00Z',
    source: 'vehicle_events.final_price (sold, USD via fx_to_usd)',
    currency: 'USD',
  },
  comps: {
    populated: true,
    n: 3,
    rows: [
      {
        vehicle_id: VEH1, year: 1967, make: 'Chevrolet', model: 'Chevelle', trim: 'SS',
        sale_price: 64000, miles: 42000, platform: 'Bring a Trailer',
        sold_date: '2026-08-01T00:00:00Z', listing_url: 'https://bringatrailer.com/listing/chevelle-ss',
      },
      {
        vehicle_id: VEH2, year: 1967, make: 'Chevrolet', model: 'Chevelle', trim: null,
        sale_price: 51000, miles: null, platform: 'Mecum',
        sold_date: '2026-10-02T00:00:00Z', listing_url: 'https://mecum.com/lots/chevelle',
      },
      {
        vehicle_id: VEH3, year: 1967, make: 'Chevrolet', model: 'Chevelle', trim: null,
        sale_price: 45500, miles: 88000, platform: null,
        sold_date: null, listing_url: 'javascript:alert(1)',
      },
    ],
  },
};

function ld(page: { head?: string }): unknown {
  const m = page.head?.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('no json-ld');
  return JSON.parse(m[1]);
}

function types(graph: unknown): string[] {
  const g = graph as { '@graph'?: Array<{ '@type'?: string }> };
  return (g['@graph'] ?? []).map((n) => String(n['@type']));
}

describe('cohort market report', () => {
  it('keeps SITE in lockstep with discoveryFace', () => {
    expect(REPORT_SITE).toBe(SITE);
  });

  it('sorts comps by sold date, newest first, and caps the list', () => {
    const rows: CohortComp[] = [
      { vehicle_id: 'a', year: 1967, make: 'Chevrolet', model: 'Chevelle', trim: null, sale_price: 1, miles: null, platform: null, sold_date: '2026-01-01', listing_url: null },
      { vehicle_id: 'b', year: 1967, make: 'Chevrolet', model: 'Chevelle', trim: null, sale_price: 2, miles: null, platform: null, sold_date: '2026-06-01', listing_url: null },
      { vehicle_id: 'c', year: 1967, make: 'Chevrolet', model: 'Chevelle', trim: null, sale_price: 3, miles: null, platform: null, sold_date: null, listing_url: null },
    ];
    expect(recentComps(rows, 2).map((c) => c.vehicle_id)).toEqual(['b', 'a']);
  });

  it('builds a dated, cited year page from the terminal and omits unsafe source URLs', () => {
    const page = buildCohortReport('chevrolet', 'chevelle', 1967, TERMINAL);
    expect(page.path).toBe('/cohort/chevrolet/chevelle/1967');
    expect(page.title).toBe('1967 Chevrolet Chevelle value: $57,208 | Nuke');
    expect(page.description).toContain('$57,208');
    expect(page.description).toContain('105 recorded sales');
    expect(page.description).toContain('2026-11-20');
    expect(page.body).toContain('<h1>1967 Chevrolet Chevelle</h1>');
    expect(page.body).toContain('Median sale $57,208 · 105 recorded sales · Observed 2026-11-20');
    expect(page.body).toContain('Recorded range $12,000–$90,000, middle half $41,000–$70,000');
    expect(page.body).toContain('Computed 2026-11-20');
    expect(page.body).toContain('Latest recorded sale 2026-10-02');
    expect(page.body).toContain('80 public vehicles in this cohort');
    expect(page.body).toContain('<h2>What is a 1967 Chevrolet Chevelle worth?</h2>');
    expect(page.body).toContain('https://bringatrailer.com/listing/chevelle-ss');
    expect(page.body).toContain('https://mecum.com/lots/chevelle');
    expect(page.body).toContain(`${SITE}/vehicle/${VEH2}`);
    expect(page.body).toContain('2026-10-02');
    expect(page.body).not.toContain('javascript:');
    expect(page.body).toContain(`${SITE}/vehicle/${VEH3}`);
    expect(page.body).toContain(`href="${SITE}/cohort/chevrolet"`);
    expect(page.body).toContain(`href="${SITE}/cohort/chevrolet/chevelle"`);
    // Newest comp first
    expect(page.body.indexOf(VEH2)).toBeLessThan(page.body.indexOf(VEH1));
  });

  it('every dollar amount in the page and JSON-LD comes from the terminal', () => {
    const page = buildCohortReport('chevrolet', 'chevelle', 1967, TERMINAL);
    const report = parseCohortTerminal('chevrolet', 'chevelle', 1967, TERMINAL);
    const allowed = new Set(fixtureMoney(report));
    const claimed = moneyAmounts(`${page.title}\n${page.description}\n${page.body}\n${page.head}`);
    expect(claimed.length).toBeGreaterThan(0);
    for (const n of claimed) expect(allowed).toContain(n);
    const graph = ld(page) as { '@graph': Array<Record<string, unknown>> };
    const values: number[] = [];
    const walk = (v: unknown) => {
      if (typeof v === 'number' && Number.isFinite(v)) values.push(v);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.values(v as Record<string, unknown>).forEach(walk);
    };
    walk(graph);
    const countable = new Set([...allowed, report.price.n ?? -1, report.year, ...report.comps.map((c) => c.year).filter((y): y is number => y != null)]);
    for (const n of values) expect(countable.has(n) || allowed.has(n)).toBe(true);
  });

  it('emits Dataset, Vehicle, and FAQ JSON-LD with the recorded median', () => {
    const page = buildCohortReport('chevrolet', 'chevelle', 1967, TERMINAL);
    const graph = ld(page) as { '@context': string; '@graph': Array<Record<string, unknown>> };
    expect(graph['@context']).toBe('https://schema.org');
    expect(types(graph)).toEqual(['Dataset', 'Vehicle', 'FAQPage']);
    const dataset = graph['@graph'][0];
    expect(dataset.dateModified).toBe('2026-11-20');
    expect(dataset.url).toBe(`${SITE}/cohort/chevrolet/chevelle/1967`);
    const measured = dataset.variableMeasured as Array<{ name: string; value: number }>;
    expect(measured.find((m) => m.name === 'median sale price')?.value).toBe(57208);
    const vehicle = graph['@graph'][1];
    expect(vehicle.manufacturer).toBe('Chevrolet');
    expect(vehicle.model).toBe('Chevelle');
    expect(vehicle.modelDate).toBe('1967');
    const faq = graph['@graph'][2];
    const entity = (faq.mainEntity as Array<Record<string, unknown>>)[0];
    expect(entity.name).toBe('What is a 1967 Chevrolet Chevelle worth?');
    expect((entity.acceptedAnswer as { text: string }).text).toBe(cohortWorthAnswer(parseCohortTerminal('chevrolet', 'chevelle', 1967, TERMINAL)));
    expect(cohortJsonLd(parseCohortTerminal('chevrolet', 'chevelle', 1967, TERMINAL))['@graph']).toHaveLength(3);
  });

  it('omits empty price, range, and comps rather than inventing numbers', () => {
    const page = buildCohortReport('chevrolet', 'chevelle', 1967, { resolved: true, price_distribution: { populated: false }, comps: { populated: false } });
    expect(page.title).toBe('1967 Chevrolet Chevelle | Nuke');
    expect(page.title).not.toContain('$');
    expect(page.body).not.toContain('$');
    expect(page.body).not.toContain('Median sale');
    expect(page.body).not.toContain('Recorded range');
    expect(page.body).not.toContain('Recent recorded sales');
    expect(page.body).toContain('What is a 1967 Chevrolet Chevelle worth?');
    expect(page.body).toContain('does not yet have enough recorded sold prices');
    expect(moneyAmounts(`${page.title}\n${page.description}\n${page.body}\n${page.head}`)).toEqual([]);
    const graph = ld(page) as { '@graph': Array<Record<string, unknown>> };
    expect(types(graph)).toEqual(['Dataset', 'Vehicle', 'FAQPage']);
    expect(graph['@graph'][0].variableMeasured).toBeUndefined();
    expect(graph['@graph'][0].dateModified).toBeUndefined();
  });

  it('shows a median without inventing a range when min and max are absent', () => {
    const page = buildCohortReport('Ford', 'Mustang', 1966, {
      resolved: true,
      price_distribution: { populated: true, median: 45000, n: 2, observed_at: '2026-11-01' },
    });
    expect(page.body).toContain('Median sale $45,000 · 2 recorded sales · Observed 2026-11-01');
    expect(page.body).not.toContain('Recorded range');
    expect(page.body).not.toContain('middle half');
    expect(page.body).not.toContain('Recent recorded sales');
    expect(new Set(moneyAmounts(page.body))).toEqual(new Set([45000]));
  });
});
