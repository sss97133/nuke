import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/supabase', () => {
  const rpc = vi.fn();
  const from = vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(async () => ({ data: [], error: null })),
            })),
          })),
        })),
      })),
    })),
  }));

  return {
    supabase: {
      rpc,
      from,
    },
  };
});

import { supabase } from '../../lib/supabase';
import { CashflowDealsService } from '../cashflowDealsService';

describe('CashflowDealsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists public deals for a user with correct filters', async () => {
    // Arrange: override the chained builder to capture calls
    const order = vi.fn(async () => ({ data: [{ id: 'd1' }], error: null }));
    const eq4 = vi.fn(() => ({ order }));
    const eq3 = vi.fn(() => ({ eq: eq4 }));
    const eq2 = vi.fn(() => ({ eq: eq3 }));
    const eq1 = vi.fn(() => ({ eq: eq2 }));
    const select = vi.fn(() => ({ eq: eq1 }));
    const from = vi.fn(() => ({ select }));
    (supabase as any).from = from;

    // Act
    const rows = await CashflowDealsService.listPublicDealsForUser('user-123');

    // Assert
    expect(from).toHaveBeenCalledWith('cashflow_deals');
    expect(select).toHaveBeenCalledWith(
      'id, deal_type, title, rate_bps, cap_multiple_bps, term_end_at, subject_user_id, is_public'
    );
    expect(eq1).toHaveBeenCalledWith('subject_type', 'user');
    expect(eq2).toHaveBeenCalledWith('subject_user_id', 'user-123');
    expect(eq3).toHaveBeenCalledWith('status', 'active');
    expect(eq4).toHaveBeenCalledWith('is_public', true);
    expect(order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(rows).toEqual([{ id: 'd1' }]);
  });

  it('createUserDeal calls create_cashflow_deal with correct payload', async () => {
    (supabase as any).rpc = vi.fn(async () => ({ data: 'deal-id-1', error: null }));

    const id = await CashflowDealsService.createUserDeal({
      subjectUserId: 'user-123',
      dealType: 'advance',
      title: 'Advance (Recoupable)',
      rateBps: 2000,
      capMultipleBps: 13000,
      termEndAt: null,
      isPublic: true,
    });

    expect((supabase as any).rpc).toHaveBeenCalledWith('create_cashflow_deal', {
      p_deal_type: 'advance',
      p_subject_type: 'user',
      p_subject_id: 'user-123',
      p_title: 'Advance (Recoupable)',
      p_rate_bps: 2000,
      p_cap_multiple_bps: 13000,
      p_term_end_at: null,
      p_is_public: true,
      p_metadata: {},
    });
    expect(id).toBe('deal-id-1');
  });

  it('fundDeal calls fund_cashflow_deal with correct payload', async () => {
    (supabase as any).rpc = vi.fn(async () => ({ data: 'claim-id-1', error: null }));

    const claimId = await CashflowDealsService.fundDeal('deal-abc', 2500);

    expect((supabase as any).rpc).toHaveBeenCalledWith('fund_cashflow_deal', {
      p_deal_id: 'deal-abc',
      p_amount_cents: 2500,
    });
    expect(claimId).toBe('claim-id-1');
  });
});

