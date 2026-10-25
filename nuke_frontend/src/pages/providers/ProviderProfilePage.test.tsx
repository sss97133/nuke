// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ readers: {} as Record<string, unknown>, rpc: vi.fn(), user: null as null | { id: string }, profileId: 'u-1' as string | null, loading: false, lookup: vi.fn() }));
vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: fixture.user, session: null, loading: fixture.loading }) }));
vi.mock('../../lib/supabase', () => ({ supabase: {
  rpc: fixture.rpc,
  from: () => {
    type Query = { select: () => Query; eq: () => Query; maybeSingle: () => ReturnType<typeof fixture.lookup> };
    const q: Query = { select: () => q, eq: () => q, maybeSingle: fixture.lookup };
    return q;
  },
} }));
import ProviderProfilePage from './ProviderProfilePage';

function profile(context: string) {
  return {
    as_of: '2026-10-19T19:00:00Z',
    viewer: { context, slots: [], money_visible: false },
    subject: { kind: 'user', handle: 'mechanic1', profile_id: 'u-1', city: 'Example City', state: 'NV', member_since: '2025-09-07T00:00:00Z',
      email: 'private@example.test', phone: '555-0100', legal_name: 'Private Person' },
    claims: { account: { role: 'user', user_type: 'admin', profession: 'mechanic', expertise_areas: ['square_body_restoration'] },
      actor_records: [{ specialties: ['welding', 'fabrication'] }] },
    capabilities: { items: [
      { capability_type: 'welding_tig', strength: 'corroborating', derivation: 'evidence_fold', evidence_count: 2,
        basis_counts: { direct: 0, corroborating: 2, against: 1 }, last_demonstrated: '2026-03-15' },
      { capability_type: 'fabrication_exhaust', complexity_tier: 'intermediate', strength: 'not_assessed', derivation: 'legacy_hand_entered', evidence_count: 3 },
    ] },
    tools: {
      seen_in_frame: { occurrences: 313, frames_analyzed: 833, frames_with_tools: 220, images_scanned: 1000, images_eligible: 1538,
        top_labels: [{ label: 'two-post lift', occurrences: 71 }] },
      claimed_owned: { user_tools: [{ category: 'Pliers', records: 9 }], tool_inventory: [] },
      co_signed: { supporting_attestations: 0, authenticated_attestations: 0 },
    },
    facilities: [{ relation_kind: 'ownership', name: 'Example Shop', role: 'owner', relation: { state: 'live' } }],
    vouched_for_by: { items: [{ vouch_id: 'v-1', voucher: { kind: 'user', handle: 'shopowner2', name: 'Private Voucher' }, kinds: ['supervision'], vouched_at: '2026-10-01T00:00:00Z' }] },
    identity_bridge: { state: 'evidenced' },
    work_record: {
      days: { signed_work_days: 3, days_with_capture: 809, capture_span_hours: { value: 1395.9 }, first_day: '2024-01-01', last_day: '2026-06-20' },
      jobs: { jobs: 2, by_role: { performer: 1, shop_owner: 1 }, completion: { recorded: 0, status_only: 0, absent: 1 } },
    },
    contact: { action: 'contact_via_nuke', available: false, request: { context_kind: 'profile', context_id: 'u-1', recipient_user_id: 'u-1' } },
  };
}

const jobs = { as_of: '2026-10-19T19:00:00Z', coverage: { returned: 1, total_for_subject: 1 }, next_after: null, rows: [{
  work_order_id: 'wo-1', display_title: 'Synthetic exhaust job', vehicle_label: { text: '1983 GMC K2500' }, subject_roles: ['performer'],
  operation_kinds: { fabricate: 3 }, stage_states: { intake: 'recorded', execution: 'recorded', accounting: 'withheld' }, dates: {} }] };

const productivity = { as_of: '2026-10-19T19:00:00Z', range: { from: '2026-07-21', to: '2026-10-19' },
  totals: { days_with_activity: 9, self_confirmed_days: 0, customer_accepted_days: 0, operations_completed: 0, completions_accepted: 0 },
  days: [{ day: '2026-10-15', image_evidence: 61, signed: { self_confirmed: false, customer_accepted: false } }], day_rate_jobs: [] };

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.user = null;
  fixture.loading = false;
  fixture.lookup.mockReset().mockImplementation(() => Promise.resolve({ data: fixture.profileId ? { id: fixture.profileId } : null, error: null }));
  fixture.profileId = 'u-1';
  fixture.readers = { provider_profile_read: profile('visitor'), provider_job_record_read: jobs, provider_productivity_read: productivity };
  fixture.rpc.mockReset();
  fixture.rpc.mockImplementation((name: string) => Promise.resolve({ data: fixture.readers[name] ?? null, error: null }));
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

async function render(path = '/providers/mechanic1') {
  await act(async () => root.render(<MemoryRouter initialEntries={[path]}><Link to="/providers/actor/a-2">Other provider</Link><Routes>
    <Route path="/providers/actor/:actorId" element={<ProviderProfilePage />} />
    <Route path="/providers/:handle" element={<ProviderProfilePage />} />
  </Routes></MemoryRouter>));
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
}

describe('ProviderProfilePage for a visitor', () => {
  it('keeps what they say apart from what the record shows', async () => {
    await render();
    const text = host.textContent ?? '';
    expect(host.querySelector('h1')?.textContent).toBe('@mechanic1');
    expect(text).toContain('What they say');
    expect(text).toContain('Mechanic');
    expect(text).toContain('Self-described');
    expect(text).toContain('What the record shows');
    expect(text).toContain('Corroborating records · 2 corroborating · 1 against');
    expect(text).toContain('Older records, basis not kept');
    expect(text).toContain('1 of 2 capability rows derived from evidence');
  });

  it('shows no account settings, contact fields, private names or shops to a visitor', async () => {
    await render();
    const html = host.innerHTML;
    for (const leak of ['private@example.test', '555-0100', 'Private Person', 'Private Voucher', 'Example Shop', 'Account type', 'Admin']) {
      expect(html).not.toContain(leak);
    }
    expect(host.textContent).toContain('@shopowner2');
  });

  it('labels photo time as photo time, not labor, and tools by how they are known', async () => {
    await render();
    const text = host.textContent ?? '';
    expect(text).toContain('Photo time, not hours worked');
    expect(text).toContain('Seen in their photos · attributed');
    expect(text).toContain('They say they own · self-described');
    expect(text).toContain('from 220 of 833 analysed photos');
  });

  it('lists jobs on record and productivity, linking to the job page', async () => {
    await render();
    expect(host.querySelector('a[href="/jobs/wo-1"]')?.textContent).toContain('Synthetic exhaust job');
    expect(host.textContent).toContain('9 of 91 days with activity');
    expect(host.textContent).toContain('61 photos · not signed');
  });

  it('asks a signed-out visitor to sign in to contact them through Nuke', async () => {
    await render();
    expect(host.textContent).toContain('Sign in');
    expect(host.textContent).toContain('to contact @mechanic1 through Nuke');
    expect(host.querySelector('textarea')).toBeNull();
  });

  it('says when no public profile has the handle', async () => {
    fixture.profileId = null;
    await render('/providers/nobody');
    expect(host.querySelector('h1')?.textContent).toBe('No public profile');
  });
});

describe('ProviderProfilePage for the person themself', () => {
  it('shows their shops and account settings, labelled, and no contact form', async () => {
    fixture.user = { id: 'u-1' };
    fixture.readers.provider_profile_read = profile('self');
    await render();
    const text = host.textContent ?? '';
    expect(text).toContain('Your shops');
    expect(text).toContain('Example Shop');
    expect(text).toContain('Account type');
    expect(text).toContain('What you say');
    expect(host.querySelector('[aria-label="Contact via Nuke"]')).toBeNull();
  });
});

describe('ProviderProfilePage for an actor', () => {
  it('reads by actor id and links the evidenced handle', async () => {
    fixture.readers.provider_profile_read = { ...profile('visitor'), subject: { kind: 'actor', actor_id: 'a-1', display: { kind: 'user', handle: 'mechanic1' } } };
    await render('/providers/actor/a-1');
    expect(fixture.rpc).toHaveBeenCalledWith('provider_profile_read', { p_actor_id: 'a-1' });
    expect(host.querySelector('a[href="/providers/mechanic1"]')).not.toBeNull();
  });
});

it('clears a self-only work record immediately when the viewer signs out', async () => {
  fixture.user = { id: 'u-1' };
  fixture.readers.provider_profile_read = profile('self');
  await render();
  expect(host.textContent).toContain('Example Shop');
  fixture.user = null;
  fixture.readers.provider_profile_read = profile('visitor');
  await render();
  expect(host.textContent).not.toContain('Example Shop');
  expect(host.textContent).not.toContain('Account type');
  expect(host.textContent).toContain('What they say');
});


const click = async (label: string) => { await act(async () => { Array.from(host.querySelectorAll('button')).find(button => button.textContent === label)!.click(); }); };
const publicContact = () => ({ ...profile('visitor'), contact: { available: true, request: { context_kind: 'profile', context_id: 'u-1', recipient_user_id: 'u-1' } } });
const writeContact = async () => {
  await click('Contact via Nuke');
  await act(async () => { const input = host.querySelector('textarea')!; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'Synthetic request'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  await click('Review');
};

it('keeps same-viewer state and hides it while auth readiness is unknown', async () => {
  fixture.user = { id: 'u-1' }; fixture.readers.provider_profile_read = profile('self'); await render();
  const calls = fixture.rpc.mock.calls.length; fixture.user = { id: 'u-1' }; await render();
  expect(fixture.rpc).toHaveBeenCalledTimes(calls); expect(host.textContent).toContain('Example Shop');
  fixture.loading = true; await render(); expect(host.textContent).not.toContain('Example Shop'); expect(host.textContent).toContain('Checking the viewer');
});

it('discards late private profile results after changing viewers', async () => {
  let finish!: (value: unknown) => void; fixture.user = { id: 'u-1' };
  fixture.rpc.mockImplementation((name: string) => name === 'provider_profile_read' ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ data: fixture.readers[name], error: null }));
  await render(); fixture.user = { id: 'u-2' }; fixture.rpc.mockImplementation((name: string) => Promise.resolve({ data: fixture.readers[name], error: null })); await render();
  await act(async () => finish({ data: profile('self'), error: null }));
  expect(host.textContent).not.toContain('Example Shop'); expect(host.textContent).toContain('What they say');
});

it.each(['returned', 'rejected'])('distinguishes a %s lookup failure from a missing provider and retries', async kind => {
  if (kind === 'returned') fixture.lookup.mockResolvedValueOnce({ data: null, error: { message: 'Network failed' } });
  else fixture.lookup.mockRejectedValueOnce(new Error('Network failed'));
  await render(); expect(host.textContent).toContain('Profile lookup unavailable'); expect(host.textContent).not.toContain('No public profile'); expect(host.textContent).not.toContain("This isn't public");
  await click('Retry profile lookup'); expect(host.textContent).toContain('What they say');
});

it('keeps existing jobs on a failed next page and retries without duplicating them', async () => {
  fixture.readers.provider_job_record_read = { ...jobs, next_after: 'wo-1', coverage: { returned: 1, total_for_subject: 2 } }; await render();
  let finish!: (value: unknown) => void; fixture.rpc.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await click('More jobs'); await act(async () => finish({ data: null, error: { message: 'Next page failed' } }));
  expect(host.textContent).toContain('Synthetic exhaust job'); expect(host.textContent).toContain('More jobs could not be loaded');
  fixture.rpc.mockResolvedValue({ data: { ...jobs, rows: [...jobs.rows, { ...jobs.rows[0], work_order_id: 'wo-2', display_title: 'Second job' }] }, error: null });
  await click('Retry more jobs'); expect(host.querySelectorAll('a[href="/jobs/wo-1"]')).toHaveLength(1); expect(host.textContent).toContain('Second job');
  expect(fixture.rpc).toHaveBeenLastCalledWith('provider_job_record_read', { p_user_id: 'u-1', p_actor_id: null, p_after: 'wo-1', p_limit: 10 });
});

it('discards a previous subject page continuation after navigation', async () => {
  fixture.readers.provider_job_record_read = { ...jobs, next_after: 'wo-1' }; await render();
  let finish!: (value: unknown) => void;
  fixture.rpc.mockImplementation((name: string, args: Record<string, unknown>) => args.p_after ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ data: name === 'provider_job_record_read' ? { ...jobs, rows: [{ ...jobs.rows[0], display_title: 'New subject job' }] } : fixture.readers[name], error: null }));
  await click('More jobs'); await act(async () => (host.querySelector('a[href="/providers/actor/a-2"]') as HTMLAnchorElement).click());
  await act(async () => finish({ data: { ...jobs, rows: [{ ...jobs.rows[0], display_title: 'PRIVATE OLD PAGE' }] }, error: null }));
  expect(host.textContent).toContain('New subject job'); expect(host.textContent).not.toContain('PRIVATE OLD PAGE');
});

it('removes a contact draft on an actual viewer change without sending it', async () => {
  fixture.user = { id: 'u-2' }; fixture.readers.provider_profile_read = publicContact(); await render(); await writeContact(); expect(host.textContent).toContain('Sending says');
  fixture.user = { id: 'u-3' }; await render(); expect(host.querySelector('textarea')).toBeNull();
  expect(fixture.rpc.mock.calls.some(([name]) => name === 'request_contact')).toBe(false);
});

it('surfaces rejected contact sends, preserves the reviewed draft, and requires a confirmed request id', async () => {
  fixture.user = { id: 'u-2' }; fixture.readers.provider_profile_read = publicContact(); await render(); await writeContact();
  fixture.rpc.mockRejectedValueOnce(new Error('offline')); await click('Send request');
  expect(host.textContent).toContain('The request could not be completed'); expect(host.querySelector('textarea')?.value).toBe('Synthetic request');
  fixture.rpc.mockResolvedValueOnce({ data: null, error: null }); await click('Send request'); expect(host.textContent).toContain('The request could not be confirmed'); expect(host.textContent).not.toContain('Request sent in Nuke');
  fixture.rpc.mockResolvedValueOnce({ data: { request_id: 'request-1', status: 'pending' }, error: null }); await click('Send request'); expect(host.textContent).toContain('Request sent in Nuke');
  expect(fixture.rpc).toHaveBeenLastCalledWith('request_contact', { p_context_kind: 'profile', p_context_id: 'u-1', p_message: 'Synthetic request', p_recipient_user_id: 'u-1', p_recipient_actor_id: null, p_recipient_organization_id: null });
});

it('sends once while pending and ignores a late old-viewer contact response', async () => {
  fixture.user = { id: 'u-2' }; fixture.readers.provider_profile_read = publicContact(); await render(); await writeContact();
  let finish!: (value: unknown) => void;
  fixture.rpc.mockImplementation((name: string) => name === 'request_contact' ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ data: fixture.readers[name], error: null }));
  await act(async () => { const button = Array.from(host.querySelectorAll('button')).find(item => item.textContent === 'Send request')!; button.click(); button.click(); });
  expect(fixture.rpc.mock.calls.filter(([name]) => name === 'request_contact')).toHaveLength(1);
  fixture.user = { id: 'u-3' }; await render();
  await act(async () => finish({ data: { request_id: 'old-request', status: 'pending' }, error: null }));
  expect(host.textContent).not.toContain('Request sent in Nuke'); expect(host.querySelector('textarea')).toBeNull();
  expect(host.textContent).toContain('Contact via Nuke');
});
