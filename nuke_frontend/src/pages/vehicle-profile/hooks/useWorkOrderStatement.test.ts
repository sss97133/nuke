import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('../../../lib/supabase', () => ({ supabase: { rpc: (...args: unknown[]) => rpc(...args) } }));

import { readStatement } from './useWorkOrderStatement';

const WO = '30000000-0000-0000-0000-00000000000a';

describe('readStatement lookup keys', () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({ data: { work_orders: [] }, error: null });
  });

  it('reads one work order, one vehicle or one handle', async () => {
    await readStatement(`wo:${WO}`);
    await readStatement(`vehicle:${WO}`);
    await readStatement('handle:@fixture_one');
    expect(rpc.mock.calls).toEqual([
      ['work_order_statement_read', { p_work_order_id: WO }],
      ['work_order_statement_read', { p_vehicle_id: WO }],
      ['work_order_statement_read', { p_handle: 'fixture_one' }],
    ]);
  });

  it('tries a bare uuid as a work order, then as a vehicle', async () => {
    rpc.mockResolvedValueOnce({ data: { error: 'no_match', lookup: 'work_order_id' }, error: null });
    await readStatement(WO);
    expect(rpc.mock.calls).toEqual([
      ['work_order_statement_read', { p_work_order_id: WO }],
      ['work_order_statement_read', { p_vehicle_id: WO }],
    ]);
  });

  it('treats any other text as a handle, never as a name or e-mail search', async () => {
    await readStatement('smith');
    expect(rpc).toHaveBeenCalledWith('work_order_statement_read', { p_handle: 'smith' });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain('resolve_work_order_status');
  });

  it('surfaces reader errors', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'Work order unavailable' } });
    await expect(readStatement(`wo:${WO}`)).rejects.toThrow('Work order unavailable');
  });
});
