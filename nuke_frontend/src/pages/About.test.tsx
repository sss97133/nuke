// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import About from './About';
import { parseEvidence, plain } from './aboutEvidence';

const FIXTURE = `
intro text

<!-- evidence:start -->
Measured 2026-10-13 07:56 UTC from the live database by [\`scripts/data/readme-stats.mjs\`](../scripts/data/readme-stats.mjs), run daily. Read-only. The unit is the lot.

| Model | Sold lots graded, of lots ended | Median absolute error | Bias (mean signed error) | Hammer inside its stated band | Close: scheduled / final / predicted |
|---|---|---|---|---|---|
| 31 | 751 of 1,343 | 26.2% | +16.2% | 591 of 751 = 78.7% (80% band) | 282 / 469 / 0 |
| 24 | 747 of 995 | 24.3% | −13.2% | 193 of 747 = 25.8% (50% band) | 0 / 244 / 503 |

- **Lots predicted:** 2,290 distinct lots, in 46,094 of 54,702 prediction rows (\`hammer_predictions\`).
- **Stacks:** 65 registered, 64 at status measured.
<!-- evidence:end -->

later text
`;

describe('parseEvidence', () => {
  it('reads the stamp, the table and the notes as plain text', () => {
    const e = parseEvidence(FIXTURE)!;
    expect(e.measuredAt).toBe('2026-10-13T07:56:00Z');
    expect(e.preface.startsWith('Measured 2026-10-13 07:56 UTC from the live database by scripts/data/readme-stats.mjs')).toBe(true);
    expect(e.columns).toHaveLength(6);
    expect(e.models.map(m => m.model)).toEqual(['31', '24']);
    expect(e.models[0]).toMatchObject({ graded: 751, ended: 1343 });
    expect(e.models[0].cells[2]).toBe('26.2%');
    expect(e.notes).toEqual([
      { title: 'Lots predicted', text: '2,290 distinct lots, in 46,094 of 54,702 prediction rows (hammer_predictions).' },
      { title: 'Stacks', text: '65 registered, 64 at status measured.' },
    ]);
  });
  it('yields null for a document without the block, never a typed number', () => {
    expect(parseEvidence('# no block here')).toBeNull();
    expect(parseEvidence('<!-- evidence:start -->\nMeasured 2026-01-01 00:00 UTC.\n<!-- evidence:end -->')).toBeNull();
  });
  it('strips links, code and emphasis', () => {
    expect(plain('see [`a.mjs`](../a.mjs) and **bold** `code`')).toBe('see a.mjs and bold code');
  });
});

describe('About', () => {
  let root: Root, container: HTMLDivElement;
  // The page fetches /evidence.md, the file the daily stats job writes into public/; the test serves that very file.
  const served = readFileSync(resolve(__dirname, '../../public/evidence.md'), 'utf8');
  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url === '/evidence.md' ? new Response(served, { status: 200 }) : new Response('', { status: 404 }))));
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

  async function render() {
    await act(async () => { root.render(<MemoryRouter><About /></MemoryRouter>); });
    // The evidence block arrives by fetch; give it a few turns.
    for (let i = 0; i < 40 && !container.querySelector('table'); i++) await act(async () => { await new Promise(r => setTimeout(r, 25)); });
  }
  const text = () => container.textContent || '';
  const link = (name: string) => [...container.querySelectorAll('a')].find(a => a.textContent === name);

  it('says what Nuke is in the positioning voice and carries no pitch-deck language', async () => {
    await render();
    expect(container.querySelector('h1')?.textContent).toBe('Nuke');
    expect(text()).toMatch(/observational ledger for physical assets/);
    for (const banned of [/token/i, /NFT/, /\$9\.99/, /AI-powered/i, /Windows 95/, /roadmap/i, /stakeholder/i]) expect(text()).not.toMatch(banned);
    expect(link('The live board')?.getAttribute('href')).toBe('/?tab=market');
    expect(link('What the ledger recorded')?.getAttribute('href')).toBe('/journal');
    expect(link('The public repository')?.getAttribute('href')).toBe('https://github.com/sss97133/nuke');
    expect(container.querySelector('h1')?.className).toContain('k-entity');
    expect(container.querySelector('[style]')).toBeNull();
  });

  it('says so, and links the document, when the block cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));
    await act(async () => { root.render(<MemoryRouter><About /></MemoryRouter>); });
    for (let i = 0; i < 40 && !/did not load/.test(text()); i++) await act(async () => { await new Promise(r => setTimeout(r, 25)); });
    expect(text()).toMatch(/The grading table did not load here/);
    expect(container.querySelector('table')).toBeNull();
    expect(link('docs/POSITIONING.md')?.getAttribute('href')).toBe('https://github.com/sss97133/nuke/blob/main/docs/POSITIONING.md');
  });

  it('renders the daily-measured grading block from /evidence.md with its date and coverage', async () => {
    await render();
    const table = container.querySelector('table[aria-label="Graded models"]');
    expect(table).not.toBeNull();
    expect(table!.querySelectorAll('tbody tr').length).toBeGreaterThan(0);
    expect(table!.querySelector('tbody td .k-measure')).not.toBeNull();
    expect(text()).toMatch(/Measured \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC from the live database/);
    const coverage = container.querySelector('.k-section__head .k-coverage')?.getAttribute('aria-label') || '';
    expect(coverage).toMatch(/^Coverage: [\d,]+ of [\d,]+ lots graded, model \d+ · \w{3} \d{1,2}, \d{4}$/);
  });
});
