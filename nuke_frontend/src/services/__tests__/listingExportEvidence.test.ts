import { beforeEach, expect, it, vi } from 'vitest';
import { fixture, VEHICLE } from './listingEvidenceFixture';
import type { ChannelDef } from '../channelRegistry';
const state = vi.hoisted(() => ({ invoke: vi.fn(), from: vi.fn(), insert: vi.fn(), dispatch: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: { auth: { getUser: async () => ({ data: { user: { id: 'owner' } } }) },
  functions: { invoke: state.invoke }, from: state.from } }));
vi.mock('../channelAdapters', () => ({ dispatchChannel: state.dispatch }));
import { ListingExportService } from '../listingExportService';
const channel = { id: 'bat', platform: 'bat', label: 'BaT', mechanism: 'human', liveStatus: 'live' } as unknown as ChannelDef;
beforeEach(() => { vi.clearAllMocks(); state.from.mockReturnValue({ insert: state.insert });
  state.insert.mockReturnValue({ select: () => ({ single: async () => ({ data: { id: 'export' }, error: null }) }) });
  state.dispatch.mockReturnValue({ status: 'prepared', note: 'Human review required' }); });
it('failed package does not dispatch or insert an export', async () => {
  state.invoke.mockResolvedValue({ data: null, error: { message: 'offline' } });
  expect((await ListingExportService.submitToChannel({ vehicle_id: VEHICLE, channel })).success).toBe(false);
  expect(state.dispatch).not.toHaveBeenCalled(); expect(state.insert).not.toHaveBeenCalled();
});
it('a raw or mechanically promoted package cannot dispatch', async () => {
  for (const data of [{ identity: { engine_type: 'SD455' } }, { ...fixture(), identity: { ...fixture().identity, engine_type: 'SD455' } }]) {
    state.invoke.mockResolvedValue({ data, error: null });
    expect((await ListingExportService.submitToChannel({ vehicle_id: VEHICLE, channel })).success).toBe(false);
  }
  expect(state.dispatch).not.toHaveBeenCalled(); expect(state.insert).not.toHaveBeenCalled();
});
it('qualified copy reaches channel dispatch with its attributed evidence retained in the private export snapshot', async () => {
  state.invoke.mockResolvedValue({ data: fixture(), error: null });
  expect((await ListingExportService.submitToChannel({ vehicle_id: VEHICLE, channel })).success).toBe(true);
  const row = state.insert.mock.calls[0][0]; expect(row.description).toBe('Source-reported make: Pontiac.');
  expect(row.description).not.toContain('SD455'); expect(row.metadata.assessment.attestations).toEqual(fixture().assessment.attestations);
  expect(row.metadata.listing_assertions).toEqual(fixture().listing_assertions); expect(row.metadata.ars_score).toBeNull();
});
