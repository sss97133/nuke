import { beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ session: null as any, data: null as any, error: null as any, reads: 0, rpcs: [] as any[] }));
vi.mock('../../lib/supabase', () => ({ supabase: {
  auth: { getSession: async () => ({ data: { session: fixture.session } }) },
  rpc: async (name: string, args: any) => { fixture.rpcs.push({ name, args }); return { data: fixture.data, error: fixture.error }; },
  from: () => { fixture.reads++; throw new Error('A capped table read cannot replace complete aggregates'); },
} }));
import { PersonalPhotoLibraryService } from '../personalPhotoLibraryService';
beforeEach(() => { fixture.session = null; fixture.data = null; fixture.error = null; fixture.reads = 0; fixture.rpcs = []; });
it('requires an authenticated owner before requesting coverage', async () => {
  await expect(PersonalPhotoLibraryService.getLibraryStats()).rejects.toThrow('Not authenticated');
  expect(fixture.rpcs).toEqual([]);
});
it('preserves full aggregates and separate source-analysis coverage', async () => {
  fixture.session = { user: { id: 'owner' } };
  fixture.data = { total_photos: 28000, source_analysis: { records: 30000, accuracy: null, recent: { failed: 82 } } };
  const result = await PersonalPhotoLibraryService.getLibraryStats();
  expect(result.total_photos).toBe(28000);
  expect(result.source_analysis).toEqual(fixture.data.source_analysis);
  expect(fixture.rpcs).toEqual([{ name: 'get_photo_library_stats', args: { p_user_id: 'owner' } }]);
});
it('exposes authorization and reader errors instead of inventing capped totals', async () => {
  fixture.session = { user: { id: 'owner' } }; fixture.error = { code: '42501', message: 'owner required' };
  await expect(PersonalPhotoLibraryService.getLibraryStats()).rejects.toEqual(fixture.error);
  expect(fixture.reads).toBe(0);
});
it('keeps a missing aggregate distinct from an empty library', async () => {
  fixture.session = { user: { id: 'owner' } };
  await expect(PersonalPhotoLibraryService.getLibraryStats()).rejects.toThrow('returned no data');
});
it('preserves unavailable suggestion counts instead of coercing them to zero', async () => {
  fixture.session = { user: { id: 'owner' } };
  fixture.data = { total_photos: 28000, ai_suggestions_count: null, ai_suggestions_state: 'unavailable' };
  const result = await PersonalPhotoLibraryService.getLibraryStats();
  expect(result.ai_suggestions_count).toBeNull(); expect(result.ai_suggestions_state).toBe('unavailable');
});
