import { expect, it, vi } from 'vitest';

vi.mock('../lib/supabase', () => ({ supabase: {
  from: (table: string) => {
    const query: Record<string, unknown> = {};
    query.select = () => query;
    query.eq = () => query;
    const result = { data: table === 'businesses' ? { is_public: false, discovered_by: null }
      : table === 'organization_contributors' ? { role: 'accountant', status: 'active' } : null };
    query.single = async () => result;
    query.maybeSingle = async () => result;
    return query;
  },
} }));

import { getOrgPermissions, getRoleBadge } from './organizationPermissions';

it('gives Accounting visibility without general organization editing or administration', async () => {
  const permissions = await getOrgPermissions('fixture-org', 'fixture-accountant');
  expect(permissions).toMatchObject({ role: 'accountant', canView: true, canEdit: false, canLinkVehicles: false, canDelete: false, canManageMembers: false });
  expect(getRoleBadge('accountant').text).toBe('ACCOUNTING');
});
