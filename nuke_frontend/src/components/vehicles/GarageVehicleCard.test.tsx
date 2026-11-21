// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GarageTimelineDay, GarageVehicle } from '../../hooks/useVehiclesDashboard';
import type { ReelRow } from '../garage/garageReel';
import type { AnalysisLine } from '../garage/GarageCardAnalysis';

vi.mock('../PrefetchLink', () => ({ default: ({ to, children, ...props }: { to: string; children?: React.ReactNode } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={to} {...props}>{children}</a> }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: vi.fn(() => Promise.resolve({ data: null, error: null })) } }));
const reel = vi.hoisted(() => ({ start: vi.fn(), page: vi.fn(), analysis: vi.fn() }));
vi.mock('../garage/garageReel', async original => ({ ...(await original<typeof import('../garage/garageReel')>()), readReelStart: reel.start, readReelPage: reel.page }));
vi.mock('../garage/GarageCardAnalysis', async original => ({ ...(await original<typeof import('../garage/GarageCardAnalysis')>()), readCardAnalysis: reel.analysis }));

import { GarageVehicleCard, MiniBarcode, garageAxis } from './GarageVehicleCard';

const NOW = new Date('2026-11-21T12:00:00Z'); // the window runs from Monday 2025-11-17 to today
const WIDTH = 300;
const day = (at: string, photos: number, work = 0): GarageTimelineDay => [at, photos, work, 0, 0];
const car = (days: GarageTimelineDay[], extra: Partial<GarageVehicle> = {}): GarageVehicle => ({
  id: 'synthetic-car', year: 1973, make: 'Pontiac', model: 'Firebird', trim: null, vin: null, primary_image_url: null,
  resolved_image_url: 'https://images.example/cover.jpg', estimated_value: null, purchase_price: null, value_delta: null,
  health_score: null, image_count: 40, event_count: null, view_count: null, last_event_title: null, last_event_at: null,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', relationship_type: 'OWNER', relationship_source: 'ownership',
  event_weeks: null, event_summary: null,
  timeline: { first_day: days[days.length - 1][0], last_day: days[0][0], active_days: days.length, photos: 40, work_days: 3, events: 2, documents: 1, days },
  ...extra,
});
const rows = (n: number, at: string, from = 0): ReelRow[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${at}-${from + i}`, image_url: `https://images.example/${at}-${from + i}.jpg`, is_sensitive: false, taken_at: `${at}T10:00:00Z` }));

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => WIDTH });
  HTMLElement.prototype.scrollTo = vi.fn(function (this: HTMLElement, options?: ScrollToOptions | number) {
    if (typeof options === 'object' && options.left != null) this.scrollLeft = options.left;
  }) as unknown as typeof HTMLElement.prototype.scrollTo;
  HTMLElement.prototype.scrollBy = vi.fn() as unknown as typeof HTMLElement.prototype.scrollBy;
  // The squares drawn 530 px wide: about ten pixels a week.
  SVGElement.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, width: 530, height: 70, right: 530, bottom: 70, x: 0, y: 0, toJSON: () => ({}) });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  reel.start.mockReset(); reel.page.mockReset(); reel.analysis.mockReset();
  reel.analysis.mockResolvedValue([] as AnalysisLine[]);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

const render = (node: React.ReactNode) => act(async () => root.render(node));
const svg = () => host.querySelector('svg.garage-barcode') as SVGSVGElement;
const wheel = (deltaX: number, deltaY = 0) => {
  const event = new WheelEvent('wheel', { deltaX, deltaY, bubbles: true, cancelable: true });
  act(() => { svg().dispatchEvent(event); });
  return event;
};
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const click = (target: Element, init: MouseEventInit = {}) => act(async () => { target.dispatchEvent(new MouseEvent('click', { bubbles: true, ...init })); await settle(); await settle(); });
const reelNode = () => host.querySelector('.garage-card-reel') as HTMLDivElement;
const lastScroll = () => (HTMLElement.prototype.scrollTo as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];

describe('MiniBarcode window', () => {
  const vehicle = car([day('2026-10-05', 4), day('2026-10-06', 0, 1), day('2023-08-07', 9)]);
  const axis = garageAxis([vehicle], NOW);

  it('moves back through the past on a sideways swipe, keeps the page still and returns on a double-click', async () => {
    const onWindow = vi.fn();
    await render(<MiniBarcode vehicle={vehicle} axis={axis} movable onWindow={onWindow} />);
    expect(svg().getAttribute('aria-label')).toContain('in the last year');
    // Fingers to the right: the squares follow them into the past, about ten weeks for a hundred pixels.
    expect(wheel(-100).defaultPrevented).toBe(true);
    expect(onWindow).toHaveBeenLastCalledWith('Sep 2025 – Sep 2026');
    expect(svg().getAttribute('aria-label')).toContain('Sep 2025 – Sep 2026');
    // An up-and-down scroll is the page's.
    expect(wheel(4, 120).defaultPrevented).toBe(false);
    // Never past the car's first recorded day, never past today; the same shading steps throughout.
    for (let i = 0; i < 40; i++) wheel(-400);
    expect(onWindow).toHaveBeenLastCalledWith('Aug 2023 – Aug 2024');
    expect(host.querySelector('rect[data-level]')?.getAttribute('data-level')).toBe(String(1 + axis.steps.filter(step => 9 > step).length));
    await act(async () => { svg().dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
    expect(onWindow).toHaveBeenLastCalledWith(null);
    expect(wheel(500).defaultPrevented).toBe(true);
    expect(onWindow).toHaveBeenLastCalledWith(null);
  });

  it('asks for a day with photos on a click, from the square or the nearest one to a fingertip, and never after a drag', async () => {
    const onDay = vi.fn();
    await render(<MiniBarcode vehicle={vehicle} axis={axis} movable onDay={onDay} />);
    await click(host.querySelector('rect[data-day="2026-10-05"]')!);
    expect(onDay).toHaveBeenLastCalledWith('2026-10-05');
    // A work-only day has nothing to show in the reel.
    expect(host.querySelector('rect[data-day="2026-10-06"]')).toBeNull();
    const scale = Math.min(530 / 52.84, 70 / 6.84);
    // 2026-10-05 is 46 weeks after 2025-11-17, a Monday: column 46, row 0. A tap just off the square still lands.
    await click(svg(), { clientX: 46 * scale + 0.88 * scale, clientY: 0.7 + 0.4 * scale });
    expect(onDay).toHaveBeenCalledTimes(2);
    await click(svg(), { clientX: 46 * scale + 0.4 * scale, clientY: 0.7 + 1.4 * scale });
    expect(onDay).toHaveBeenCalledTimes(2);
    await act(async () => {
      svg().dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 100, pointerType: 'touch' }));
      svg().dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, clientX: 160, pointerType: 'touch' }));
      svg().dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, clientX: 160, pointerType: 'touch' }));
    });
    await click(svg(), { clientX: 46 * scale + 0.4 * scale, clientY: 0.7 + 0.4 * scale });
    expect(onDay).toHaveBeenCalledTimes(2);
  });

  it('stays still where it is not asked to move (the garage summary)', async () => {
    await render(<MiniBarcode vehicle={vehicle} axis={axis} />);
    expect(wheel(-100).defaultPrevented).toBe(false);
    expect(svg().hasAttribute('data-movable')).toBe(false);
    expect(host.querySelector('rect[data-photo]')).toBeNull();
  });
});

describe('grid card', () => {
  it('toggles the Analysis chip back to the photo he was on', async () => {
    reel.start.mockResolvedValue({ sequence: [], page: rows(3, '2026-11-01'), total: 3 });
    reel.analysis.mockResolvedValue([{ key: 'built', group: 'money', label: 'Built', value: '$1', cite: '' }]);
    await render(<GarageVehicleCard vehicle={car([day('2026-11-01', 3)], { image_count: 4 })} />);
    await click(host.querySelector('button[aria-label="Next photo"]')!);
    const chip = () => host.querySelector('.garage-card-to-analysis') as HTMLButtonElement;
    expect(chip().textContent).toBe('Analysis');
    // On the third frame (cover, then three photos).
    reelNode().scrollLeft = 2 * WIDTH;
    await act(async () => { reelNode().dispatchEvent(new Event('scroll')); });
    await click(chip());
    expect(lastScroll()).toEqual({ left: 4 * WIDTH });
    expect(chip().textContent).toBe('Photos');
    expect(chip().getAttribute('aria-pressed')).toBe('true');
    await click(chip());
    expect(lastScroll()).toEqual({ left: 2 * WIDTH });
    expect(chip().textContent).toBe('Analysis');
  });

  it('moves the reel to the first photo of a clicked day, reading past the loaded page to reach it', async () => {
    const days = [day('2026-11-01', 12), day('2026-10-10', 5), day('2026-03-02', 2)];
    reel.start.mockResolvedValue({ sequence: [], page: rows(12, '2026-11-01'), total: 19 });
    reel.page.mockResolvedValue([...rows(5, '2026-10-10'), ...rows(2, '2026-03-02')]);
    await render(<GarageVehicleCard vehicle={car(days)} axis={garageAxis([car(days)], NOW)} />);
    await click(host.querySelector('rect[data-day="2026-03-02"]')!);
    // 17 photos on newer days, 2 on the day and a page of slack, held to the reel's 19: one read of the last 7.
    expect(reel.page).toHaveBeenCalledWith('synthetic-car', 12, 7);
    // The cover, twelve, five, then the day's first photo: frame 18.
    expect(lastScroll()).toEqual({ left: 18 * WIDTH });
    expect(host.querySelector('.garage-card-frame')?.textContent).toBe('19 / 20');
  });

  it('leaves the photo count to the photo, lists the rest, and links the papers to their pages', async () => {
    await render(<GarageVehicleCard vehicle={car([day('2026-11-01', 3)])} />);
    const counts = host.querySelector('.garage-card-counts')!;
    expect(counts.textContent).toBe('3 work days2 events1 paper');
    expect(counts.querySelector('a')?.getAttribute('href')).toBe('/vehicle/synthetic-car#build-receipt-pages');
    expect(host.querySelector('.garage-card-frame')?.textContent).toBe('1 / 40');
    await render(<GarageVehicleCard vehicle={car([day('2026-11-01', 3)], { resolved_image_url: null, image_count: 3 })} />);
    expect(host.querySelector('.garage-card-counts')?.textContent).toContain('40 photos');
  });
});
