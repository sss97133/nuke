// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
vi.mock('../hooks/useIsMobile', () => ({ useIsMobile: () => false }));
import { MIN_DISTRIBUTION } from '../pages/stacks/bidMeasurements';
import { RANK_FLOOR, rankLabel, formatMeasure, day, plural, ShareBar, MeasureView, ClaimView, Text, Measures, Strip, Facet } from './index';

let root: Root, host: HTMLDivElement;
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const render = (node: React.ReactElement) => act(() => root.render(node));
const coverage = { n: 27, of: 1338, grain: 'peer auctions', as_of: '2026-10-08T05:29:00Z' };

describe('rank floor', () => {
  it('equals the stacks floor so the two never drift', () => {
    expect(RANK_FLOOR).toBe(MIN_DISTRIBUTION);
  });
  it('refuses a percentile under the floor', () => {
    expect(rankLabel({ p: 96, n: 1 })).toBeNull();
    expect(rankLabel({ p: 96, n: RANK_FLOOR - 1 })).toBeNull();
    expect(rankLabel({ p: 96, n: RANK_FLOOR })).toBe('P96');
    expect(rankLabel(null)).toBeNull();
    expect(rankLabel({ p: 140, n: 50 })).toBe('P100');
  });
});

describe('MeasureView', () => {
  it('says unranked with the peer count when one peer was measured', () => {
    render(<MeasureView m={{ label: 'Bids', value: 1, unit: 'count', method: 'bids', coverage, rank: { p: 96, n: 1 } }} />);
    expect(host.textContent).toContain('unranked · 1 peer');
    expect(host.textContent).not.toContain('P96');
    expect(host.textContent).toContain('27 of 1,338 peer auctions · Oct 8, 2026');
  });
  it('shows the rank with its peers above the floor', () => {
    render(<MeasureView m={{ label: 'Competition', value: 12, unit: 'count', method: 'participants', coverage, rank: { p: 76.4, n: 27 } }} />);
    expect(host.textContent).toContain('P76 of 27 peers');
    expect(host.querySelector('.k-measure')?.textContent).toBe('12');
  });
});

describe('ClaimView', () => {
  it('renders the value as a button and opens its source', () => {
    render(<ClaimView label="Last recorded sale" role="measure" format={v => '$' + Number(v).toLocaleString('en-US')}
      claim={{ value: 24000, unit: 'USD', source: { kind: 'listing', url: 'https://example.test/lot', label: 'BaT' }, observed_at: '2026-09-21', trust: 0.9 }} />);
    const button = host.querySelector('button.k-claim__value') as HTMLButtonElement;
    expect(button.textContent).toBe('$24,000');
    expect(document.body.textContent).not.toContain('Observed');
    act(() => button.click());
    expect(document.body.textContent).toContain('Sep 21, 2026');
    expect(document.body.textContent).toContain('BaT');
    expect(document.body.textContent).toContain('90%');
    expect(document.body.querySelector('img.k-claim__logo')?.getAttribute('src')).toBe('/source-logos/bat.png');
  });

  it('shows the auction PNG logo, lot number, and opens the sale moment video popup when clicked', () => {
    render(<ClaimView label="Last recorded sale" role="measure" format={v => '$' + Number(v).toLocaleString('en-US')}
      claim={{
        value: 242000,
        unit: 'USD',
        source: {
          kind: 'listing',
          url: 'https://www.mecum.com/lots/1128139/1971-plymouth-hemi-road-runner/',
          label: 'MECUM',
          method: 'sold',
          lotNumber: 'F162.1',
          auctionName: 'Kissimmee 2025',
          video: {
            url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
            startSeconds: 185,
            lotNumber: 'F162.1',
            auctionName: 'Kissimmee 2025',
            title: '1971 Plymouth Hemi Road Runner',
            priceText: '$242,000',
          },
        },
        observed_at: '2025-01-17',
        trust: 0.9,
      }} />);
    act(() => (host.querySelector('button.k-claim__value') as HTMLButtonElement).click());
    expect(document.body.querySelector('img.k-claim__logo')?.getAttribute('src')).toBe('/source-logos/mecum.png');
    expect(document.body.textContent).toContain('Lot F162.1 · Kissimmee 2025');
    const playBtn = document.body.querySelector('button.k-claim__play-btn') as HTMLButtonElement;
    expect(playBtn).not.toBeNull();
    expect(playBtn.textContent).toContain('Watch sale moment (3:05)');
    act(() => playBtn.click());
    const iframe = document.body.querySelector('iframe.k-video-modal__iframe') as HTMLIFrameElement;
    expect(iframe).not.toBeNull();
    expect(iframe.getAttribute('src')).toContain('https://www.youtube.com/embed/dQw4w9WgXcQ');
    expect(iframe.getAttribute('src')).toContain('start=185');
  });
});

describe('Text and formatting', () => {
  it('maps a role to exactly one kit class and no inline style', () => {
    render(<Text role="entity" as="h1">Mustang</Text>);
    const h1 = host.querySelector('h1')!;
    expect(h1.className).toBe('k-entity');
    expect(h1.getAttribute('style')).toBeNull();
  });
  it('adds a dense form to entity and measure only', () => {
    render(<><Text role="entity" dense>Lot</Text><Text role="measure" dense>12</Text><Text role="body" dense>facts</Text></>);
    expect(host.querySelector('.k-entity')?.className).toBe('k-entity k-entity--dense');
    expect(host.querySelector('.k-measure')?.className).toBe('k-measure k-measure--dense');
    expect(host.querySelector('.k-body')?.className).toBe('k-body');
  });
  it('formats units and clocks', () => {
    expect(formatMeasure(24000, 'USD')).toBe('$24,000');
    expect(formatMeasure(12.345, '%')).toBe('12.3%');
    expect(formatMeasure(1338, 'count')).toBe('1,338');
    expect(formatMeasure(NaN, 'USD')).toBe('unknown');
    expect(day('nope')).toBe('unknown date');
    expect(day(null)).toBe('unknown date');
  });
});

describe('containers', () => {
  it('Measures renders nothing for an empty stack and a section with coverage otherwise', () => {
    const empty = { n: 0, of: 10, grain: 'lots', as_of: null };
    render(<Measures title="Performance" coverage={empty} items={[]} />);
    expect(host.textContent).toBe('');
    render(<Measures title="Performance" coverage={{ ...empty, n: 3 }} items={[{ label: 'Bids', value: 3, unit: 'count', method: 'bids', coverage: { ...empty, n: 3 } }]} />);
    expect(host.querySelector('section.k-section')).not.toBeNull();
    expect(host.querySelector('h2.k-label')?.textContent).toBe('Performance');
    expect(host.textContent).toContain('3 of 10 lots');
  });
  it('Strip puts coverage last and a facet opens', () => {
    let opened = false;
    render(<Strip coverage={{ n: 2, of: 5, grain: 'facets attributed', as_of: null }}><Facet label="Coupe" expanded={false} onClick={() => { opened = true; }} /></Strip>);
    act(() => (host.querySelector('button.k-facet') as HTMLButtonElement).click());
    expect(opened).toBe(true);
    expect(host.textContent?.endsWith('2 of 5 facets attributed')).toBe(true);
  });
});


describe('plural and ShareBar', () => {
  it('counts with the noun in the right number, with separators', () => {
    expect(plural(1, 'row')).toBe('1 row');
    expect(plural(0, 'row')).toBe('0 rows');
    expect(plural(1204, 'row')).toBe('1,204 rows');
    expect(plural(1, 'row needs', 'rows need')).toBe('1 row needs');
    expect(plural(2, 'row needs', 'rows need')).toBe('2 rows need');
  });
  it('draws the stored percentage as the width, clamped to the track, and draws nothing for an unknown share', () => {
    render(<ShareBar share={77.7} />);
    expect(host.querySelector('.k-share-bar__fill')?.getAttribute('width')).toBe('77.7');
    expect(host.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    render(<ShareBar share={140} />);
    expect(host.querySelector('.k-share-bar__fill')?.getAttribute('width')).toBe('100');
    render(<ShareBar share={-5} />);
    expect(host.querySelector('.k-share-bar__fill')?.getAttribute('width')).toBe('0');
    render(<ShareBar share={null} />);
    expect(host.querySelector('svg')).toBeNull();
  });
});
