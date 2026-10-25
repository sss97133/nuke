// @vitest-environment jsdom
// Every writer here is a mock: no test calls a production writer.
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ readers: {} as Record<string, unknown>, rpc: vi.fn() }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: null, loading: false }) }));
vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: fixture.rpc } }));
import { JobPublication } from './Publication';
import { listingLine, publicationTitle } from './publicationWords';
import VehicleWorkCard from './VehicleWorkCard';
import { parseAction } from './jobRead';

const WO = '00000000-0000-4000-a000-0000000000aa';
const REFUSAL = 'Remove names and contact details from the job title and description before opening it; contact goes through Nuke';
const publishOpen = (refused: string | null = null) => ({ action: 'publish_work_order', rpc: 'publish_work_order', args: { p_work_order_id: WO, p_visibility: 'open' },
  visibility: 'open', refused_reason: refused, binds: ['your statement that this job is open: technicians near you can see its needs and offer'],
  does_not_bind: ['a price', 'your contact details (contact goes through Nuke)'] });
const publishInvite = { action: 'publish_work_order', rpc: 'publish_work_order', args: { p_work_order_id: WO, p_visibility: 'invite_only' }, visibility: 'invite_only',
  binds: ['your statement that this job is published invite only'], does_not_bind: ['a price'] };
const state = (visibility: string, actions: unknown[], extra: object = {}) => ({ work_order_id: WO, visibility, requirements: 0, listed_in_open_requirements: false,
  last_sign: null, viewer: { party: actions.length > 0, actions }, ...extra });

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.readers = {};
  fixture.rpc.mockReset();
  fixture.rpc.mockImplementation((name: string) => Promise.resolve(name in fixture.readers ? { data: fixture.readers[name], error: null }
    : name.endsWith('_work_order') ? { data: { visibility: 'open', requirements_derived: [{}, {}] }, error: null } : { data: null, error: { message: 'not mocked' } }));
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const render = async (node: React.ReactElement) => {
  await act(async () => root.render(<MemoryRouter>{node}</MemoryRouter>));
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
};
const button = (t: string) => [...document.querySelectorAll('button')].find(b => b.textContent === t) as HTMLButtonElement | undefined;
const writes = () => fixture.rpc.mock.calls.filter(([n]) => String(n).endsWith('_work_order'));

describe('publication words', () => {
  it('titles each step by where it moves the job', () => {
    expect(publicationTitle(parseAction(publishOpen())!, 'not_published')).toBe('Publish: open to technicians');
    expect(publicationTitle(parseAction(publishInvite)!, 'not_published')).toBe('Publish: invite only');
    expect(publicationTitle(parseAction(publishOpen())!, 'invite_only')).toBe('Change to open');
    expect(publicationTitle(parseAction({ action: 'unpublish_work_order', rpc: 'unpublish_work_order' })!, 'open')).toBe('Unpublish');
  });
  it('says whether an open job is actually listed', () => {
    expect(listingLine({ visibility: 'open', requirements: 3, listed_in_open_requirements: true })).toBe('Listed on Jobs with 3 needs.');
    expect(listingLine({ visibility: 'open', requirements: 0, listed_in_open_requirements: false })).toBe('Open, but no needs are listed yet.');
    expect(listingLine({ visibility: 'invite_only', requirements: 2 })).toBeNull();
  });
});

describe('JobPublication', () => {
  it('shows a visitor the visibility and no steps', async () => {
    fixture.readers.work_order_publication_read = state('open', [], { requirements: 2, listed_in_open_requirements: true });
    await render(<JobPublication workOrderId={WO} />);
    expect(host.textContent).toContain('Open — technicians near you can offer');
    expect(host.textContent).toContain('Listed on Jobs with 2 needs.');
    expect(host.querySelector('button')).toBeNull();
  });

  it('lets the owner publish open only after confirming, with exactly the server args', async () => {
    fixture.readers.work_order_publication_read = state('not_published', [publishOpen(), publishInvite]);
    await render(<JobPublication workOrderId={WO} />);
    expect(host.textContent).toContain('Not published');
    await act(async () => button('Publish: open to technicians')!.click());
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.textContent).toContain('Your statement that this job is open');
    expect(dialog.textContent).toContain('Your contact details (contact goes through Nuke)');
    expect(writes()).toHaveLength(0);
    await act(async () => [...dialog.querySelectorAll('button')].find(b => b.textContent === 'Publish: open to technicians')!.click());
    expect(writes()).toEqual([['publish_work_order', { p_work_order_id: WO, p_visibility: 'open' }]]);
    expect(document.body.textContent).toContain('2 needs recorded from your description');
  });

  it('shows the server refusal instead of a confirm when contact details block open', async () => {
    fixture.readers.work_order_publication_read = state('invite_only', [publishOpen(REFUSAL)]);
    await render(<JobPublication workOrderId={WO} />);
    const b = button('Change to open')!;
    expect(b.disabled).toBe(true);
    expect(host.textContent).toContain(REFUSAL);
    await act(async () => b.click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(writes()).toHaveLength(0);
  });
});

describe('vehicle Work rows', () => {
  it('carry each job’s visibility and steps from one publication read', async () => {
    fixture.readers.vehicle_work_orders_read = { rows: [{ work_order_id: WO, display_title: 'Drivetrain service', slots: ['customer'] }], coverage: { total_for_vehicle: 1 },
      as_of: '2026-10-19T19:00:00Z', viewer: { actions: [], vehicle_access: null }, vehicle_label: { text: '1983 GMC K2500' } };
    fixture.readers.vehicle_work_publication_read = { rows: [state('open', [{ action: 'unpublish_work_order', rpc: 'unpublish_work_order', args: { p_work_order_id: WO },
      binds: ['your statement that this job is no longer listed; it becomes invite only'], does_not_bind: ['payment'] }], { requirements: 1, listed_in_open_requirements: true })] };
    await render(<VehicleWorkCard vehicleId="v1" vehicleTitle="1983 GMC K2500" signedIn />);
    expect(host.textContent).toContain('Open — technicians near you can offer · Listed on Jobs with 1 need.');
    await act(async () => button('Unpublish')!.click());
    await act(async () => [...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent === 'Unpublish')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(writes()).toEqual([['unpublish_work_order', { p_work_order_id: WO }]]);
    expect(fixture.rpc.mock.calls.filter(([n]) => n === 'vehicle_work_publication_read')).toHaveLength(1);
  });
});
