import { describe, expect, it } from 'vitest';
import { bucketGarage, isRecentlyWorked, latestWorkEvidence, pickCustodyOrgs, type CustodyOrg } from './garageCustody';

const now = new Date('2026-11-04T12:00:00Z');
const org = (id: string, name: string, type = 'work_location'): CustodyOrg => ({ id, name, relationship_type: type });
const link = (vehicle_id: string, organization_id: string, relationship_type: string, extra: Record<string, unknown> = {}) => ({
  vehicle_id, organization_id, relationship_type, status: 'active', organizations: { business_name: `Org ${organization_id}` }, ...extra,
});

describe('pickCustodyOrgs', () => {
  it('uses recorded active custody links and ignores ownership, sales and rejected links', () => {
    const result = pickCustodyOrgs([
      link('a', 'ernie', 'work_location'),
      link('b', 'dealer', 'sold_by'),
      link('c', 'ernie', 'work_location', { user_rejected: true }),
      link('d', 'ernie', 'work_location', { status: 'ended' }),
      link('e', 'ernie', 'work_location', { end_date: '2026-10-01' }),
    ], now);
    expect([...result.keys()]).toEqual(['a']);
    expect(result.get('a')).toEqual({ id: 'ernie', name: 'Org ernie', relationship_type: 'work_location' });
  });

  it('keeps unconfirmed auto-tagged guesses out until a person confirms them', () => {
    const rows = [link('a', 'ernie', 'work_location', { auto_tagged: true }),
      link('b', 'ernie', 'work_location', { auto_tagged: true, user_confirmed: true })];
    expect([...pickCustodyOrgs(rows, now).keys()]).toEqual(['b']);
  });

  it('prefers the physical location over a service link, and a car in service over one that is not', () => {
    const result = pickCustodyOrgs([
      link('a', 'shop', 'service_provider'), link('a', 'lot', 'work_location'),
      link('b', 'idle', 'work_location', { service_status: 'idle' }), link('b', 'busy', 'work_location', { service_status: 'currently_in_service' }),
    ], now);
    expect(result.get('a')?.id).toBe('lot');
    expect(result.get('b')?.id).toBe('busy');
  });
});

describe('latestWorkEvidence', () => {
  it('counts EXIF photo dates and work sessions inside seven days, newest wins', () => {
    const result = latestWorkEvidence(
      [{ vehicle_id: 'a', taken_at: '2026-11-03T23:28:43Z' }, { vehicle_id: 'a', taken_at: '2026-11-01T10:00:00Z' },
        { vehicle_id: 'old', taken_at: '2026-10-20T10:00:00Z' }],
      [{ vehicle_id: 's', start_time: '2026-11-02T15:00:00Z', end_time: '2026-11-02T18:00:00Z' }], now);
    expect(result.get('a')).toBe('2026-11-03T23:28:43.000Z');
    expect(result.get('s')).toBe('2026-11-02T18:00:00.000Z');
    expect(result.has('old')).toBe(false);
  });

  it('ignores duplicates, gate-rejected photos, impossible future dates and sessions with no photo behind them', () => {
    const result = latestWorkEvidence(
      [{ vehicle_id: 'dup', taken_at: '2026-11-03T10:00:00Z', is_duplicate: true },
        { vehicle_id: 'rej', taken_at: '2026-11-03T10:00:00Z', vision_gate_status: 'rejected_personal' },
        { vehicle_id: 'future', taken_at: '2027-01-01T00:00:00Z' }],
      [{ vehicle_id: 'obsolete', session_date: '2026-11-03', metadata: { auto_resolution: { status: 'closed_obsolete' } } }], now);
    expect(result.size).toBe(0);
  });
});

describe('bucketGarage', () => {
  const v = (id: string, extra: Record<string, unknown> = {}) => ({ id, ...extra }) as { id: string; recent_work_at?: string | null; custody_org?: CustodyOrg | null };
  const ernie = org('ernie', "Ernie's Upholstery");

  it('groups cars by custody org together, pulling recently worked cars to the top instead of their group', () => {
    const rows = [
      v('blue', { custody_org: ernie }), v('green', { custody_org: ernie }),
      v('mustang', { custody_org: ernie, recent_work_at: '2026-11-03T20:00:00Z' }),
      v('ghia', { custody_org: ernie, recent_work_at: '2026-11-04T01:00:00Z' }),
      v('mine'), v('lot-car', { custody_org: org('lot', 'Storage Lot') }),
    ];
    const { recent, orgGroups, rest } = bucketGarage(rows, now);
    expect(recent.map(r => r.id)).toEqual(['ghia', 'mustang']);
    expect(orgGroups.map(g => [g.org.name, g.vehicles.map(r => r.id)])).toEqual([
      ["Ernie's Upholstery", ['blue', 'green']], ['Storage Lot', ['lot-car']]]);
    expect(rest.map(r => r.id)).toEqual(['mine']);
  });

  it('puts a car back in its group once its work evidence is older than a week', () => {
    const stale = v('stale', { custody_org: ernie, recent_work_at: '2026-10-25T00:00:00Z' });
    expect(isRecentlyWorked(stale, now)).toBe(false);
    expect(bucketGarage([stale], now).orgGroups[0].vehicles).toEqual([stale]);
  });
});
