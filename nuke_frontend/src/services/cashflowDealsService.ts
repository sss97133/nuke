import { supabase } from '../lib/supabase';

export type CashflowDealType = 'advance' | 'revenue_share';

export interface CashflowDealSummary {
  id: string;
  deal_type: CashflowDealType;
  title: string;
  rate_bps: number;
  cap_multiple_bps: number | null;
  term_end_at: string | null;
  subject_user_id: string | null;
  is_public: boolean;
}

export const CashflowDealsService = {
  async listPublicDealsForUser(userId: string): Promise<CashflowDealSummary[]> {
    const { data, error } = await supabase
      .from('cashflow_deals')
      .select('id, deal_type, title, rate_bps, cap_multiple_bps, term_end_at, subject_user_id, is_public')
      .eq('subject_type', 'user')
      .eq('subject_user_id', userId)
      .eq('status', 'active')
      .eq('is_public', true)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data || []) as any;
  },

  async createUserDeal(params: {
    subjectUserId: string;
    dealType: CashflowDealType;
    title: string;
    rateBps: number;
    capMultipleBps?: number | null;
    termEndAt?: string | null;
    isPublic?: boolean;
  }): Promise<string> {
    const { data, error } = await supabase.rpc('create_cashflow_deal', {
      p_deal_type: params.dealType,
      p_subject_type: 'user',
      p_subject_id: params.subjectUserId,
      p_title: params.title,
      p_rate_bps: params.rateBps,
      p_cap_multiple_bps: params.capMultipleBps ?? null,
      p_term_end_at: params.termEndAt ?? null,
      p_is_public: params.isPublic ?? true,
      p_metadata: {},
    });

    if (error) throw error;
    return data as string;
  },

  async fundDeal(dealId: string, amountCents: number): Promise<string> {
    const { data, error } = await supabase.rpc('fund_cashflow_deal', {
      p_deal_id: dealId,
      p_amount_cents: amountCents,
    });
    if (error) throw error;
    return data as string;
  },
};

