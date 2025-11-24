/**
 * AI Payment Service
 * Handles charging user Stripe accounts for AI tool usage
 */

import { supabase } from '../lib/supabase';

export interface AIPaymentRequest {
  userId: string;
  provider: 'openai' | 'anthropic' | 'custom';
  modelName: string;
  costCents: number;
  requestId?: string;
  metadata?: any;
}

export interface AIPaymentResult {
  success: boolean;
  transactionId?: string;
  error?: string;
}

export class AIPaymentService {
  /**
   * Charge user's Stripe account for AI tool usage
   */
  static async chargeForAIUsage(request: AIPaymentRequest): Promise<AIPaymentResult> {
    try {
      // Get user's Stripe keys
      const { data: stripeKeys, error: keysError } = await supabase
        .from('user_stripe_keys')
        .select('*')
        .eq('user_id', request.userId)
        .eq('is_active', true)
        .maybeSingle();

      if (keysError || !stripeKeys) {
        return {
          success: false,
          error: 'No active Stripe account found. Please add your Stripe keys in Capsule → Settings.'
        };
      }

      // Check user has sufficient balance
      const { data: balance } = await supabase
        .from('user_cash_balances')
        .select('available_cents')
        .eq('user_id', request.userId)
        .maybeSingle();

      if (!balance || balance.available_cents < request.costCents) {
        return {
          success: false,
          error: `Insufficient balance. Need $${(request.costCents / 100).toFixed(2)}, have $${((balance?.available_cents || 0) / 100).toFixed(2)}`
        };
      }

      // Deduct from user's cash balance
      const { error: deductError } = await supabase.rpc('deduct_cash_from_user', {
        p_user_id: request.userId,
        p_amount_cents: request.costCents,
        p_transaction_type: 'ai_tool_usage',
        p_reference_id: request.requestId ? request.requestId as any : null,
        p_metadata: {
          provider: request.provider,
          model: request.modelName,
          ...request.metadata
        }
      });

      if (deductError) {
        return {
          success: false,
          error: deductError.message
        };
      }

      // Record AI usage transaction
      const { data: transaction, error: transactionError } = await supabase
        .from('ai_usage_transactions')
        .insert({
          user_id: request.userId,
          provider: request.provider,
          model_name: request.modelName,
          cost_cents: request.costCents,
          request_id: request.requestId,
          metadata: request.metadata || {}
        })
        .select()
        .single();

      if (transactionError) {
        console.error('Error recording AI usage transaction:', transactionError);
        // Don't fail the payment if transaction recording fails
      }

      return {
        success: true,
        transactionId: transaction?.id
      };
    } catch (error: any) {
      console.error('Error charging for AI usage:', error);
      return {
        success: false,
        error: error.message || 'Failed to process AI payment'
      };
    }
  }

  /**
   * Get AI usage history for user
   */
  static async getUsageHistory(userId: string, limit = 50) {
    try {
      const { data, error } = await supabase
        .from('ai_usage_transactions')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error loading AI usage history:', error);
      return [];
    }
  }

  /**
   * Get total AI spending for user
   */
  static async getTotalSpending(userId: string) {
    try {
      const { data, error } = await supabase
        .from('ai_usage_transactions')
        .select('cost_cents')
        .eq('user_id', userId);

      if (error) throw error;
      
      const total = (data || []).reduce((sum, t) => sum + (t.cost_cents || 0), 0);
      return total;
    } catch (error) {
      console.error('Error calculating total spending:', error);
      return 0;
    }
  }
}

