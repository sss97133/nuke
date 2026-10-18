// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ profile: null as any }));
vi.mock('./VehicleProfileContext', () => ({ useVehicleProfile: () => fixture.profile }));
vi.mock('../../lib/supabase', () => ({ supabase: {
  from: () => { throw new Error('No reader allowed in clock controls'); },
} }));
import QuickStatsBar from './QuickStatsBar';
import { useSecondClock } from '../../hooks/useSecondClock';
import { PopupStackContext } from '../../components/popups/PopupStack';
import { CommentsPopup } from '../../components/popups/CommentsPopup';

const epoch = Date.parse('2026-10-18T12:00:00Z');
const minute = 60_000, hour = 60 * minute, day = 24 * hour;
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers(); vi.setSystemTime(epoch);
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network is forbidden'); }));
  fixture.profile = { vehicle: { id: 'synthetic-clock-vehicle', updated_at: new Date(epoch).toISOString() },
    vehicleImages: [], timelineEvents: [], totalCommentCount: 0, observationCount: 0 };
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  expect(vi.getTimerCount()).toBe(0);
  expect(globalThis.fetch).not.toHaveBeenCalled();
  container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});
const draw = async (children: React.ReactNode = <QuickStatsBar />) => { await act(async () => root.render(children)); };
const advance = async (ms: number) => { await act(async () => vi.advanceTimersByTimeAsync(ms)); };
const updated = (age: number) => { fixture.profile = { ...fixture.profile,
  vehicle: { ...fixture.profile.vehicle, updated_at: new Date(epoch - age).toISOString() } }; };

it.each([
  { age: 0, text: 'just now' }, { age: minute - 1, text: 'just now' },
  { age: minute, text: '1m ago' }, { age: hour - 1, text: '59m ago' },
  { age: hour, text: '1h ago' }, { age: day - 1, text: '23h ago' },
  { age: day, text: '1d ago' }, { age: 30 * day - 1, text: '29d ago' },
])('preserves initial age=$age as Updated $text', async ({ age, text }) => {
  updated(age); await draw(); expect(container.textContent).toBe(`Updated ${text}`);
});

it('preserves the existing locale date at the thirty-day boundary', async () => {
  updated(30 * day); await draw();
  expect(container.textContent).toBe(`Updated ${new Date(epoch - 30 * day).toLocaleDateString()}`);
});

it('updates immediately when the supplied updated_at changes', async () => {
  updated(3 * minute); await draw(); expect(container.textContent).toBe('Updated 3m ago');
  updated(2 * hour); await draw(); expect(container.textContent).toBe('Updated 2h ago');
});

it.each([
  { age: minute - 1000, before: 'just now', after: '1m ago' },
  { age: hour - 1000, before: '59m ago', after: '1h ago' },
  { age: day - 1000, before: '23h ago', after: '1d ago' },
  { age: 30 * day - 1000, before: '29d ago', after: null },
])('advances a mounted unchanged timestamp from $before to the next boundary', async ({ age, before, after }) => {
  updated(age); await draw(); expect(container.textContent).toBe(`Updated ${before}`);
  await advance(1000);
  expect(container.textContent).toBe(`Updated ${after ?? new Date(epoch - age).toLocaleDateString()}`);
});

it('does not freeze the timestamp age when unrelated profile state rerenders', async () => {
  await draw(); await advance(minute);
  fixture.profile = { ...fixture.profile, totalCommentCount: 4 };
  await draw();
  expect(container.textContent).toContain('4 comments');
  expect(container.textContent).toContain('Updated 1m ago');
});

it.each([undefined, null, '', 0, false, 'not-a-date', '2026-99-99', new Date(NaN)])('opts out of the clock and hides unavailable timestamp %s', async value => {
  fixture.profile.vehicle.updated_at = value;
  await draw();
  expect(container.textContent).toBe('');
  expect(vi.getTimerCount()).toBe(0);
});

it('keeps a finite future updated_at hidden until that time arrives', async () => {
  fixture.profile.vehicle.updated_at = new Date(epoch + 2000).toISOString();
  await draw(); expect(container.textContent).toBe('');
  await advance(1000); expect(container.textContent).toBe('');
  await advance(1000); expect(container.textContent).toBe('Updated just now');
});

it('uses one shared interval for multiple bars and releases it with the final subscriber', async () => {
  const bars = (second: boolean) => <><QuickStatsBar key="a" />{second && <QuickStatsBar key="b" />}</>;
  await draw(bars(true)); expect(vi.getTimerCount()).toBe(1);
  await draw(bars(false)); expect(vi.getTimerCount()).toBe(1);
  await draw(null); expect(vi.getTimerCount()).toBe(0);
});

function OtherClockConsumer() {
  const now = useSecondClock(); return <output>{now}</output>;
}
it('shares the existing store with other consumers without taking over their cleanup', async () => {
  const view = (bar: boolean) => <>{bar && <QuickStatsBar key="bar" />}<OtherClockConsumer key="other" /></>;
  await draw(view(true)); expect(vi.getTimerCount()).toBe(1);
  await draw(view(false)); expect(vi.getTimerCount()).toBe(1);
  await advance(1000); expect(container.textContent).toBe(String(epoch + 1000));
  await draw(null); expect(vi.getTimerCount()).toBe(0);
});

it('detaches a valid timestamp when it becomes unavailable and can subscribe again', async () => {
  await draw(); expect(vi.getTimerCount()).toBe(1);
  fixture.profile.vehicle.updated_at = null; await draw(); expect(vi.getTimerCount()).toBe(0);
  updated(minute); await draw(); expect(vi.getTimerCount()).toBe(1);
  expect(container.textContent).toBe('Updated 1m ago');
});

it('preserves counts and the comments popup binding while the age changes', async () => {
  updated(minute - 1000);
  fixture.profile = { ...fixture.profile, vehicleImages: ['synthetic-photo'], timelineEvents: [{ id: 'event' }],
    observationCount: 2, totalCommentCount: 4 };
  const push = vi.fn();
  await draw(<PopupStackContext.Provider value={{ push } as any}><QuickStatsBar /></PopupStackContext.Provider>);
  await advance(1000);
  const button = container.querySelector('[role="button"]')!;
  await act(async () => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  const [content, title, width] = push.mock.calls[0];
  expect(content.type).toBe(CommentsPopup);
  expect(content.props).toMatchObject({ vehicleId: 'synthetic-clock-vehicle', expectedCount: 4 });
  expect(title).toBe('COMMENTS (4)'); expect(width).toBe(460);
  expect(container.textContent).toContain('1 image'); expect(container.textContent).toContain('2 observations');
  expect(container.textContent).toContain('1 event'); expect(container.textContent).toContain('4 comments');
  expect(container.textContent).toContain('Updated 1m ago');
});

it('reflects forward and backward wall-clock jumps on the next shared tick', async () => {
  updated(10 * minute); await draw(); expect(container.textContent).toBe('Updated 10m ago');
  vi.setSystemTime(epoch + 2 * hour); await advance(1000);
  expect(container.textContent).toBe('Updated 2h ago');
  vi.setSystemTime(epoch - 20 * minute); await advance(1000);
  expect(container.textContent).toBe('');
});

it('shares and cleans the clock through StrictMode replay', async () => {
  updated(minute - 1000);
  await draw(<React.StrictMode><QuickStatsBar /></React.StrictMode>);
  expect(vi.getTimerCount()).toBe(1);
  await advance(1000); expect(container.textContent).toBe('Updated 1m ago');
  await draw(null); expect(vi.getTimerCount()).toBe(0);
});

it('keeps useful count stats when the timestamp is missing without subscribing', async () => {
  fixture.profile = { ...fixture.profile, vehicle: { id: 'synthetic-clock-vehicle' }, totalCommentCount: 1, observationCount: 1 };
  await draw(); expect(container.textContent).toBe('1 observation·1 comment');
  expect(vi.getTimerCount()).toBe(0);
});

it.each([1, new Date(epoch - 31 * day)])('preserves Date constructor semantics for timestamp %s', async value => {
  fixture.profile.vehicle.updated_at = value;
  await draw(); expect(container.textContent).toBe(`Updated ${new Date(value).toLocaleDateString()}`);
});

it('keeps the same locale date after a later clock jump', async () => {
  updated(31 * day); await draw();
  const expected = `Updated ${new Date(epoch - 31 * day).toLocaleDateString()}`;
  vi.setSystemTime(epoch + day); await advance(1000);
  expect(container.textContent).toBe(expected);
});
