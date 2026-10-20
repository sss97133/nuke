// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import live from './marketFixture.json';

const fixture = vi.hoisted(() => ({ read: null as unknown, rpc: vi.fn() }));
vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: fixture.rpc } }));
import MarketHealthPage from './MarketHealthPage';
import { count, hoursText, sparkPoints } from './marketWords';

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.read = live;
  fixture.rpc.mockReset();
  fixture.rpc.mockImplementation(() => Promise.resolve({ data: fixture.read, error: null }));
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const render = async () => {
  await act(async () => root.render(<MemoryRouter><MarketHealthPage /></MemoryRouter>));
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
};

describe('words', () => {
  it('counts in plain language and shows medians only when given', () => {
    expect(count(39, 'open request', 'open requests')).toBe('39 open requests');
    expect(count(1, 'technician', 'technicians')).toBe('1 technician');
    expect(hoursText(null)).toBeNull();
    expect(hoursText(3.25)).toBe('3.3 h');
    expect(hoursText(72)).toBe('3 days');
    expect(sparkPoints([1], 120, 24)).toBe('');
    expect(sparkPoints([0, 10], 120, 24)).toBe('0.0,23.0 120.0,1.0');
  });
});

describe('MarketHealthPage on the live payload (2026-10-19)', () => {
  it('reads the market as plain counts with coverage and no trend before the second day', async () => {
    await render();
    expect(fixture.rpc).toHaveBeenCalledWith('job_market_health_read', {});
    const text = host.textContent ?? '';
    for (const s of ['39 open requests', '1 technician linked by evidence', '23 requests have a backup supplier', '0 businesses claimed yet',
      '4 jobs open to technicians', '23 businesses with purchase records', 'No offers, quotes, starts, completions or invoices are on record yet',
      '23 of 39 open requests with a backup supplier', 'trend lines appear after the second day', "Nuke records payments; it doesn't move money."]) {
      expect(text).toContain(s);
    }
    expect(host.querySelector('svg')).toBeNull();
    expect(host.innerHTML).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    expect(host.innerHTML).not.toContain('@');
  });

  it('draws a trend once the server has kept two or more days, and step times only from medians', async () => {
    const base = live as unknown as Record<string, unknown>;
    const day1 = (base.history as Array<Record<string, unknown>>)[0];
    fixture.read = { ...base, history: [{ ...day1, date: '2026-10-17', open_requirements: 2 }, { ...day1, date: '2026-10-18', open_requirements: 20 }, day1],
      flow: { ...(base.flow as object), counts: { ...(base.flow as { counts: object }).counts, offers: 3, offers_accepted: 2 },
        step_hours: { offer_to_acceptance: { samples: 2, median_hours: 5.5 }, quote_to_acceptance: { samples: 1, median_hours: null } } } };
    await render();
    const trend = host.querySelector('[aria-label^="open requests"], [aria-label^="39 open requests"]');
    expect(trend?.getAttribute('aria-label')).toContain('2, 20, 39');
    const offersRow = [...host.querySelectorAll('.k-row')].find(r => r.textContent?.startsWith('offers made'));
    expect(offersRow?.textContent).toBe('offers made3');
    expect(host.textContent).toContain('Offer to acceptance');
    expect(host.textContent).toContain('5.5 h · 2 jobs');
    expect(host.textContent).not.toContain('Quote to acceptance');
  });

  it('explains a failed read', async () => {
    fixture.rpc.mockImplementation(() => Promise.resolve({ data: null, error: { message: 'canceling statement due to statement timeout', code: '57014' } }));
    await render();
    expect(host.textContent).toContain('took too long');
  });
});
