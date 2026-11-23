import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseEvidence } from './pages/aboutEvidence';
import { moneyAmounts } from './lib/cohortReport';
import {
  ABOUT_FAQS,
  aboutFace,
  METHODOLOGY_FAQS,
  methodologyFace,
  POSITIONING_URL,
  SOURCES_FAQS,
  sourcesFace,
  trustFace,
  type SourceBoard,
} from './lib/trustFaces';

const ROOT = resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');

const EVIDENCE_MD = readFileSync(resolve(__dirname, '../public/evidence.md'), 'utf8');

const BOARD: SourceBoard = {
  asOf: '2026-11-23T10:47:00Z',
  lines: [
    {
      name: 'Bring a Trailer',
      category: 'auction',
      held: 141869,
      heldAt: '2026-11-23T10:27:00Z',
      population: 200000,
      method: 'published catalog',
      confidence: 0.8,
      populationAt: '2026-11-01T00:00:00Z',
    },
    {
      name: 'Example House',
      category: 'auction',
      held: 12,
      heldAt: '2026-11-22T00:00:00Z',
      population: null,
      method: null,
      confidence: null,
      populationAt: null,
    },
  ],
};

function jsonLd(html: string): unknown {
  const m = /<script type="application\/ld\+json">([^<]+)<\/script>/.exec(html);
  if (!m) throw new Error('no json-ld');
  return JSON.parse(m[1]);
}

describe('methodologyFace', () => {
  it('is a self-describing page whose claims appear in the cited repo files', () => {
    const page = methodologyFace();
    expect(page.path).toBe('/methodology');
    expect(page.title).toBe('Methodology | Nuke');
    expect(page.description).toContain('0.6');
    expect(page.body).toContain('<h1>Methodology</h1>');
    expect(page.head).toContain('"@type":"FAQPage"');
    expect(page.head).toContain('"@type":"WebPage"');
    expect(page.head).toBeTruthy();
    const ld = jsonLd(page.head as string) as { '@graph': { url?: string }[] };
    expect(ld['@graph'].some((n) => n.url === 'https://nuke.ag/methodology')).toBe(true);

    const positioning = read('docs/POSITIONING.md');
    expect(positioning).toContain('observational ledger for physical assets');
    expect(positioning).toContain('source, its event time, its ingest time and its trust');
    expect(positioning).toContain('sensors, never sources');
    expect(page.body).toContain('append-only row');
    expect(page.body).toContain('sensors, never sources');
    expect(page.body).toContain(POSITIONING_URL);

    const tools = read('supabase/functions/mcp-connector/advisor/tools.ts');
    expect(tools).toContain('Confidence is capped at 0.6 until a published sale backtest justifies more');
    expect(page.body).toContain('capped at 0.6');

    const evidence = read('supabase/functions/mcp-connector/advisor/evidence.ts');
    expect(evidence).toContain('event_time');
    expect(evidence).toContain('ingested_at');
    expect(evidence).toContain('confidence_basis');
    expect(evidence).toContain('claim_score');
    expect(evidence).toContain('source_trust');
    expect(evidence).toContain('Never treat ingested_at or scrape clocks as the event date');
    expect(page.body).toContain('event_time');
    expect(page.body).toContain('ingested_at');
    expect(page.body).toContain('checked_sources');

    expect(page.body).toContain('valuation_by_ymm');
    expect(page.body).toContain('get_make_model_terminal');
    expect(page.body).toContain('href="https://nuke.ag/sources"');
    expect(page.body).toContain('href="https://nuke.ag/about"');
    expect(page.body).toContain('href="https://nuke.ag/api/docs"');
    expect(moneyAmounts(page.body + page.head + page.description)).toEqual([]);
    for (const f of METHODOLOGY_FAQS) {
      expect(page.body).toContain(f.q);
    }
  });
});

describe('aboutFace', () => {
  it('omits grades when evidence is missing and invents no numbers', () => {
    const page = aboutFace(null);
    expect(page.path).toBe('/about');
    expect(page.title).toBe('About | Nuke');
    expect(page.body).toContain('does not fall back to a typed number');
    expect(page.body).toContain('href="https://nuke.ag/evidence.md"');
    expect(page.body).toContain('Not a marketplace');
    expect(page.body).not.toContain('<table');
    expect(moneyAmounts(page.body + page.head)).toEqual([]);
    // Without evidence, the only numeric token we allow is none from a grade table.
    expect(page.body).not.toMatch(/\d[\d,]*%/);
    for (const f of ABOUT_FAQS) expect(page.body).toContain(f.q);
  });

  it('renders only cells from a parsed evidence fixture', () => {
    const evidence = parseEvidence(EVIDENCE_MD);
    expect(evidence).not.toBeNull();
    const page = aboutFace(evidence!);
    expect(page.body).toContain('<table>');
    expect(page.body).toContain(evidence!.preface);
    for (const m of evidence!.models) {
      for (const cell of m.cells) expect(page.body).toContain(cell);
    }
    expect(moneyAmounts(page.body)).toEqual([]);
  });
});

describe('sourcesFace', () => {
  it('omits counts when the board is missing', () => {
    const page = sourcesFace(null);
    expect(page.path).toBe('/sources');
    expect(page.body).toContain('could not be read');
    expect(page.body).not.toContain('lots held (counted');
    expect(moneyAmounts(page.body + page.head)).toEqual([]);
    for (const f of SOURCES_FAQS) expect(page.body).toContain(f.q);
  });

  it('lists only names and counts from the reader fixture', () => {
    const page = sourcesFace(BOARD);
    expect(page.description).toContain('2026-11-23');
    expect(page.body).toContain('Bring a Trailer');
    expect(page.body).toContain('141,869 lots held (counted 2026-11-23)');
    expect(page.body).toContain('source total 200,000');
    expect(page.body).toContain('confidence 0.8');
    expect(page.body).toContain('Example House');
    expect(page.body).toContain('12 lots held (counted 2026-11-22)');
    expect(page.body).toContain('source total unknown');
    expect(page.body).not.toContain('Hagerty');
    expect(moneyAmounts(page.body + page.head)).toEqual([]);
  });
});

describe('trustFace', () => {
  it('dispatches known paths and rejects the rest', () => {
    expect(trustFace('/methodology')?.path).toBe('/methodology');
    expect(trustFace('/about', { evidence: null })?.path).toBe('/about');
    expect(trustFace('/sources', { board: null })?.path).toBe('/sources');
    expect(trustFace('/sources/bring-a-trailer')).toBeNull();
    expect(trustFace('/compare/nuke-vs-hagerty')).toBeNull();
  });
});
