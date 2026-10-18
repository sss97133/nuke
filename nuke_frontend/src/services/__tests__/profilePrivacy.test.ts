import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  session: null as any, sessionError: null as any, rpcError: null as any,
  fields: '', reads: 0, rpcs: [] as any[],
}));
vi.mock('../../lib/supabase', () => ({ supabase: {
  auth: { getSession: async () => ({ data: { session: fixture.session }, error: fixture.sessionError }) },
  rpc: async (name: string, args: any) => {
    fixture.rpcs.push({ name, args });
    return { data: fixture.rpcError ? null : { profile: { id: args.p_user_id, email: 'owner@fixture.invalid' } }, error: fixture.rpcError };
  },
  from: () => {
    fixture.reads++;
    const query: any = {
      select(fields: string) { fixture.fields = fields; return query; },
      eq() { return query; },
      single: async () => ({ data: { id: 'person', username: 'fixture' }, error: null }),
    };
    return query;
  },
} }));
vi.mock('../aiInsightsService', () => ({ AIInsightsService: {} }));

import { ProfileService } from '../profileService';
import { PUBLIC_PROFILE_FIELDS } from '../../types/profile';

beforeEach(() => {
  fixture.session = null; fixture.sessionError = null; fixture.rpcError = null;
  fixture.fields = ''; fixture.reads = 0; fixture.rpcs = [];
});
describe('public and owner profile reads', () => {
  it('anonymous readers select explicit public fields and never request private RPC data', async () => {
    const result = await ProfileService.getProfileRecord('person');
    expect(result.data.username).toBe('fixture');
    expect(fixture.rpcs).toEqual([]);
    expect(fixture.fields).toBe(PUBLIC_PROFILE_FIELDS);
    for (const field of ['email','phone','phone_number','address','id_document_url','verification_notes','total_tool_value','tool_count']) {
      expect(fixture.fields.split(',').map(s => s.trim())).not.toContain(field);
    }
    expect(fixture.fields).not.toContain('*');
  });
  it('signed-in strangers use the same safe projection', async () => {
    fixture.session = { user: { id: 'stranger' } };
    await ProfileService.getProfileRecord('person');
    expect(fixture.rpcs).toEqual([]);
    expect(fixture.fields).toBe(PUBLIC_PROFILE_FIELDS);
  });
  it('owners use the existing private RPC with their exact id', async () => {
    fixture.session = { user: { id: 'person' } };
    const result = await ProfileService.getProfileRecord('person');
    expect(result.data.email).toBe('owner@fixture.invalid');
    expect(fixture.rpcs).toEqual([{ name: 'get_user_profile_fast', args: { p_user_id: 'person' } }]);
    expect(fixture.reads).toBe(0);
  });
  it('private RPC failures remain errors rather than falling back to a wildcard table read', async () => {
    fixture.session = { user: { id: 'person' } };
    fixture.rpcError = { code: '42501', message: 'Private profile requires its owner' };
    expect(await ProfileService.getProfileRecord('person')).toEqual({ data: null, error: fixture.rpcError });
    expect(fixture.reads).toBe(0);
  });
  it('logout switches the next read to public fields without retaining private results', async () => {
    fixture.session = { user: { id: 'person' } };
    await ProfileService.getProfileRecord('person');
    fixture.session = null;
    const result = await ProfileService.getProfileRecord('person');
    expect(result.data.email).toBeUndefined();
    expect(fixture.rpcs).toHaveLength(1);
    expect(fixture.fields).toBe(PUBLIC_PROFILE_FIELDS);
  });
  it('failed session resolution does not select a private reader', async () => {
    fixture.sessionError = { message: 'Session unavailable' };
    expect(await ProfileService.getProfileRecord('person')).toEqual({ data: null, error: fixture.sessionError });
    expect(fixture.rpcs).toEqual([]);
    expect(fixture.reads).toBe(0);
  });
});
