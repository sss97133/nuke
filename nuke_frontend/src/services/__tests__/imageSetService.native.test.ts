import { describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
import { currentPersonalAlbums, type ImageSet } from '../imageSetService';

function source(id: string, present = true): ImageSet {
  return { id, vehicle_id: null, user_id: 'synthetic', created_by: 'synthetic', name: 'Human source album',
    color: '#888', is_primary: false, display_order: 0, tags: [], created_at: '', updated_at: '',
    source_contract: 'photokit_album_v1', image_count: 1,
    metadata: { capture: { album: { present, photos: [{ local_id: 'a' }, { local_id: 'unuploaded' }] } } } } as ImageSet;
}

describe('current native source albums', () => {
  it('shows the selected source state and retains absent-upload coverage', () => {
    const result = currentPersonalAlbums([source('historical'), source('current')], [{ image_set_id: 'current' }]);
    expect(result.map(set => set.id)).toEqual(['current']);
    expect(result[0].source_count).toBe(2);
    expect(result[0].unlinked_count).toBe(1);
    expect(result[0].vehicle_id).toBeNull();
  });
  it('retains an album with no qualified uploaded image', () => {
    const unread = { ...source('current'), image_count: 0 };
    expect(currentPersonalAlbums([unread], [{ image_set_id: 'current' }])[0].unlinked_count).toBe(2);
  });
  it('does not display removed or unselected source states', () => {
    expect(currentPersonalAlbums([source('deleted', false)], [{ image_set_id: 'deleted' }])).toEqual([]);
    expect(currentPersonalAlbums([source('historical')], [])).toEqual([]);
  });
  it('preserves manually created legacy albums', () => {
    const legacy = { ...source('legacy'), source_contract: null };
    expect(currentPersonalAlbums([legacy], [])).toEqual([legacy]);
  });
});
