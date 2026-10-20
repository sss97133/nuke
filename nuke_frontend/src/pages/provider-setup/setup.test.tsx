// @vitest-environment jsdom
// Provider onboarding over fixtures shaped like the live readers (2026-10-19). Every read and write goes to a
// mock: nothing in this file reaches production.
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Call = { table?: string; op: string; payload?: unknown; fn?: string };
const fixture = vi.hoisted(() => ({
  calls: [] as Call[],
  rpc: {} as Record<string, unknown>,
  own: null as Record<string, unknown> | null,
  keys: [] as Array<Record<string, string>>,
}));
vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: async (fn: string, args: unknown) => {
      fixture.calls.push({ op: 'rpc', fn, payload: args });
      return { data: fixture.rpc[fn] ?? { ok: true }, error: null };
    },
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => q;
      q.maybeSingle = async () => ({ data: fixture.own, error: null });
      q.then = (resolve: (v: unknown) => void) => resolve({ data: table === 'tool_requirement_key_map' ? fixture.keys : [], error: null });
      q.insert = (row: unknown) => {
        fixture.calls.push({ table, op: 'insert', payload: row });
        const done = { error: null, then: (r: (v: unknown) => void) => r({ error: null }), select: () => ({ single: async () => ({ data: { id: 'claim-1' }, error: null }) }) };
        return done;
      };
      q.update = (row: unknown) => {
        fixture.calls.push({ table, op: 'update', payload: row });
        return { eq: async () => ({ error: null }) };
      };
      return q;
    },
  },
}));
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ session: { user: { id: UID } } }) }));
vi.mock('../../hooks/usePageTitle', () => ({ usePageTitle: () => {} }));
vi.mock('../../components/PrefetchLink', () => ({ PrefetchLink: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a> }));

const UID = '99999999-9999-4999-8999-999999999999';
const ACTOR = 'a0000001-0000-4000-8000-000000000001';
const ORG = 'o0000001-0000-4000-8000-000000000001';

import ProviderSetupPage from './ProviderSetupPage';
import {
  availabilityArgs, checklist, evidenceWords, keysFor, serviceAreaArgs, setupIncomplete, suggestionsFrom, toolInsert, tradeUpdate, type ToolKey,
} from './setupReaders';
import type { JsonObject } from '../jobs/jobRead';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SECRET_NAME = 'Jane Q Technician';
const SHOP_NAME = 'Private Garage LLC';

function suggestions(): JsonObject {
  return {
    as_of: '2026-10-19T20:00:00Z', viewer: { role: 'self' },
    actor_links: [{
      actor: { kind: 'actor', actor_id: ACTOR, role: 'technician', label: 'unnamed party' }, strength: 'direct',
      evidence: { total: 37, direct: 2, corroborating: 35, by_kind: { work_session: 2, observation: 35 }, approvable_for: ['work_evidence'] },
      your_claim: null, linked_to_another_account: false,
      actions: [{ action: 'claim', writer: 'account_link_claims insert',
        row: { user_id: UID, platform: 'nuke_actor', handle: ACTOR, actor_id: ACTOR, verification_method: 'self_claim' } }],
    }],
    organizations: [{ organization: { kind: 'organization', organization_id: ORG, name: 'Desert Fab' }, strength: 'corroborating',
      evidence: { photos_at_site: 120, days: 9, first_at: '2026-08-01T00:00:00Z', last_at: '2026-10-10T00:00:00Z', radius_m: 150 },
      actions: [{ action: 'ask_to_join', row: { organization_id: ORG, user_id: UID, role: 'contributor', status: 'pending', verification_method: 'self_claimed' } }] }],
    recorded_contributions: {
      contractor_work: [{ source_kind: 'contractor_work_contribution', source_id: 'c1', work_category: 'fabrication', work_description: 'Exhaust fabrication',
        work_date: '2026-09-01', labor_hours: 6, hourly_rate: 95, organization: { name: 'Desert Fab' }, snapshot_hash: 'h1', confirmation: { state: 'unconfirmed' } }],
      technician_records: [{ source_kind: 'technician', source_id: 't1', display_name: SECRET_NAME, certification_level: 'master', specializations: ['welding'],
        experience_years: 12, hourly_rate_cents: 12000, snapshot_hash: 'h2', confirmation: { state: 'confirmed' } }],
    },
    coverage: { never: ['name, phone or e-mail matching', 'automatic claims, joins or approvals'] },
  };
}

function profile(over: Partial<JsonObject> = {}): JsonObject {
  return {
    viewer: { context: 'self' }, as_of: '2026-10-19T20:00:00Z',
    subject: { kind: 'user', handle: 'tigwelder', city: 'Boulder City', state: 'NV' },
    claims: { basis: 'stated_by_account', account: { role: 'admin', user_type: 'professional', profession: 'mechanic', expertise_areas: ['tig welding'] }, actor_records: [] },
    capabilities: { items: [{ capability_type: 'welding_tig', strength: 'direct', derivation: 'evidence_fold', basis_counts: { direct: 2, corroborating: 0, against: 1 } }] },
    tools: { seen_in_frame: { top_labels: [{ label: 'tig torch', occurrences: 14 }], frames_analyzed: 800, frames_with_tools: 200 },
      claimed_owned: { user_tools: [{ category: 'welding', records: 2 }], tool_inventory: [] }, co_signed: { supporting_attestations: 0 } },
    facilities: [{ relation_kind: 'member', name: SHOP_NAME, role: 'owner' }],
    vouched_for_by: { items: [] },
    identity_bridge: { state: 'claimed', rung: 'self_claim' },
    availability: { state: 'not_declared' },
    service_area: { state: 'not_declared' },
    work_record: { days: { days_with_capture: 40, signed_work_days: 3 }, jobs: { jobs: 1 } },
    ...over,
  };
}

let root: Root | null = null;
let container: HTMLDivElement;
async function render(node: React.ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(node); });
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
}
const button = (label: string, scope: ParentNode = document) => Array.from(scope.querySelectorAll('button')).find(b => b.textContent === label)!;
const writes = () => fixture.calls.filter(c => c.op !== 'rpc' || /^(set_|confirm_)/.test(c.fn ?? ''));

beforeEach(() => {
  fixture.calls = [];
  fixture.rpc = { my_suggested_provider_links: suggestions(), provider_profile_read: profile() };
  fixture.own = { username: 'tigwelder', is_public: true, profession: 'mechanic', expertise_areas: ['tig welding'] };
  fixture.keys = [{ source_kind: 'tool_term', source_key: 'tig welder', requirement_key: 'welding.tig' }, { source_kind: 'tool_category', source_key: 'power tools', requirement_key: 'tool.power' }];
});
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ''; });

describe('setup words and builders', () => {
  it('carries no rates or names from recorded contributions', () => {
    const s = suggestionsFrom(suggestions());
    const text = JSON.stringify(s);
    expect(text).not.toContain(SECRET_NAME);
    expect(text).not.toContain('95');
    expect(text).not.toContain('12000');
    expect(s.records.map(r => r.title)).toEqual(['Exhaust fabrication', 'Technician record · Master']);
    expect(evidenceWords(s.actors[0].evidence)).toBe('2 direct, 35 corroborating — 2 work days of yours, 35 photos or records of yours');
  });

  it('writes an honest checklist', () => {
    const items = checklist(profile(), { username: 'tigwelder', is_public: true, profession: 'mechanic', expertise_areas: [] });
    const byKey = Object.fromEntries(items.map(i => [i.key, i]));
    expect(byKey.link.words).toBe('Your link is self-claimed — Nuke confirms it when your work backs it up.');
    expect(byKey.link.state).toBe('partial');
    expect(byKey.area.state).toBe('missing');
    expect(byKey.tools.words).toBe('2 tool records you say you own. Not checked in person.');
    expect(byKey.vouches.state).toBe('optional');
    expect(setupIncomplete(profile())).toBe(true);
    expect(setupIncomplete(profile({ identity_bridge: { state: 'evidenced' },
      availability: { state: 'declared', timezone: 'America/Los_Angeles', weekly: [] },
      service_area: { state: 'declared', city: 'Boulder City', state_code: 'NV', radius_miles: 25, mobile: false } }))).toBe(false);
  });

  it('refuses contact details, addresses and bad windows before any write', () => {
    expect(tradeUpdate('mechanic', 'welding, call 702-555-0101')).toEqual({ error: 'Take out phone numbers and emails.' });
    expect(tradeUpdate('mechanic', 'TIG welding, exhaust')).toEqual({ row: { profession: 'mechanic', expertise_areas: ['TIG welding', 'exhaust'] } });
    expect(serviceAreaArgs('123 Main St', 'NV', '25', false)).toEqual({ error: 'A city name only (no street address, numbers or contact details).' });
    expect(serviceAreaArgs(' Boulder  City ', 'nv', '25', true)).toEqual({ args: { p_city: 'Boulder City', p_state: 'NV', p_radius_miles: 25, p_mobile: true } });
    const days = Array.from({ length: 7 }, (_, i) => ({ on: i === 1, start: '08:00', end: '17:00' }));
    expect(availabilityArgs('America/Los_Angeles', days, [{ date: '2026-12-24', available: false }])).toEqual({ args: { p_windows: {
      timezone: 'America/Los_Angeles', weekly: [{ dow: 1, start: '08:00', end: '17:00' }], exceptions: [{ date: '2026-12-24', available: false }] } } });
    expect(availabilityArgs('UTC', days.map(d => ({ ...d, end: '07:00' })), [])).toEqual({ error: 'Mon: start before end, as HH:MM.' });
    expect(toolInsert(UID, 'x', null)).toEqual({ error: 'Name the tool in 2 to 120 characters.' });
    const map: ToolKey[] = [{ source_kind: 'tool_term', source_key: 'tig welder', requirement_key: 'welding.tig' }];
    expect(keysFor(map, 'Miller TIG welder 200', null)).toEqual(['welding.tig']);
  });
});

describe('ProviderSetupPage', () => {
  it('suggests records with evidence and claims only from the confirm button, with the server row', async () => {
    await render(<ProviderSetupPage />);
    const text = document.body.textContent ?? '';
    expect(text).toContain('Unnamed technician record');
    expect(text).toContain('2 direct, 35 corroborating');
    expect(text).toContain('Exhaust fabrication');
    expect(text).toContain('Desert Fab · Sep 1, 2026 · 6 h recorded');
    expect(text).toContain('120 of your photos on 9 days within 150 m');
    expect(text).not.toContain(SECRET_NAME);
    expect(text).not.toContain('$');
    expect(writes()).toHaveLength(0);

    await act(async () => { button('Claim it').click(); });
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('That Nuke has confirmed it');
    expect(writes()).toHaveLength(0);
    await act(async () => { button('Claim it', dialog).click(); });
    expect(writes()).toEqual([{ table: 'account_link_claims', op: 'insert',
      payload: { user_id: UID, platform: 'nuke_actor', handle: ACTOR, actor_id: ACTOR, verification_method: 'self_claim' } }]);
    expect(document.body.textContent).toContain('Claim filed. It stays self-claimed until your work backs it up.');
  });

  it('asks to join and confirms a record through their own Signs', async () => {
    await render(<ProviderSetupPage />);
    await act(async () => { button('Ask to join').click(); });
    await act(async () => { button('Send request', document.querySelector('[role="dialog"]')!).click(); });
    expect(writes()[0]).toEqual({ table: 'organization_contributors', op: 'insert',
      payload: { organization_id: ORG, user_id: UID, role: 'contributor', status: 'pending', verification_method: 'self_claimed' } });
    await act(async () => { button('Done', document.querySelector('[role="dialog"]')!).click(); });
    await act(async () => { button('Confirm').click(); });
    await act(async () => { button('Confirm', document.querySelector('[role="dialog"]')!).click(); });
    expect(writes()[1]).toEqual({ op: 'rpc', fn: 'confirm_provider_record', payload: { p_source_kind: 'contractor_work_contribution', p_source_id: 'c1', p_snapshot_hash: 'h1' } });
  });

  it('sets a service area as a city band only, from the Sign', async () => {
    await render(<ProviderSetupPage />);
    await act(async () => { button('Where and when you work').click(); });
    const set = (label: string, value: string) => {
      const input = Array.from(document.querySelectorAll('label')).find(l => l.textContent?.startsWith(label))!.querySelector('input')!;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    await act(async () => { set('City', 'Boulder City'); set('State', 'nv'); });
    await act(async () => { button('Set service area').click(); });
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('Boulder City, NV within 25 miles');
    expect(dialog.textContent).toContain('Your street address or coordinates');
    expect(writes()).toHaveLength(0);
    await act(async () => { button('Set service area', dialog).click(); });
    expect(writes()).toEqual([{ op: 'rpc', fn: 'set_provider_service_area', payload: { p_city: 'Boulder City', p_state: 'NV', p_radius_miles: 25, p_mobile: false } }]);
  });

  it('previews the visitor face without shops, account settings or contact, with the checklist', async () => {
    await render(<ProviderSetupPage />);
    await act(async () => { button('What clients will see').click(); });
    const text = document.body.textContent ?? '';
    expect(text).toContain('Technician link — Your link is self-claimed — Nuke confirms it when your work backs it up.');
    expect(text).toContain('Linked by them — not yet backed by work');
    expect(text).toContain('Tig welding');
    expect(text).toContain('Welding tig');
    expect(text).not.toContain(SHOP_NAME);
    expect(text).not.toContain('Account role');
    expect(text).not.toContain('Admin');
    expect(document.querySelector('a[href="/providers/tigwelder"]')).not.toBeNull();
    expect(writes()).toHaveLength(0);
  });
});
