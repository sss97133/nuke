import { describe, it, expect, vi, beforeEach } from 'vitest';

// A link the caller cannot read: the existence check returns nothing, and the insert answers 23505 from the unique key
// (organization_id, vehicle_id, relationship_type). Both writers treat that as "already linked".
let insertError: { code: string; message: string } | null = null;
const inserted: unknown[] = [];

vi.mock('../lib/supabase', () => {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: null, error: null }),
    update: () => chain,
    insert: async (row: unknown) => {
      inserted.push(row);
      return { error: insertError };
    },
  };
  return { supabase: { from: () => chain } };
});

import { organizationFromSource } from './organizationFromSource';
import { ImageDuplicateLinker } from './imageDuplicateLinker';

beforeEach(() => {
  insertError = null;
  inserted.length = 0;
});

describe('organization_vehicles link writers on a link the caller cannot read', () => {
  it('organizationFromSource returns the organization on 23505', async () => {
    vi.spyOn(organizationFromSource as any, 'findOrCreateOrganization').mockResolvedValue('org-1');
    insertError = { code: '23505', message: 'duplicate key value violates unique constraint' };
    await expect(organizationFromSource.linkVehicleToSourceOrganization('veh-1', 'bat')).resolves.toBe('org-1');
    expect(inserted).toHaveLength(1);
  });

  it('organizationFromSource still returns null on any other error', async () => {
    vi.spyOn(organizationFromSource as any, 'findOrCreateOrganization').mockResolvedValue('org-1');
    insertError = { code: '42501', message: 'permission denied' };
    await expect(organizationFromSource.linkVehicleToSourceOrganization('veh-1', 'bat')).resolves.toBeNull();
  });

  it('imageDuplicateLinker reports the relationship as present on 23505, and failed otherwise', async () => {
    const create = (ImageDuplicateLinker as any).createServiceRelationship.bind(ImageDuplicateLinker);
    insertError = { code: '23505', message: 'duplicate key value violates unique constraint' };
    await expect(create('veh-1', 'org-1', 'user-1', 'test')).resolves.toBe(true);
    insertError = { code: '42501', message: 'permission denied' };
    await expect(create('veh-1', 'org-1', 'user-1', 'test')).resolves.toBe(false);
  });
});
