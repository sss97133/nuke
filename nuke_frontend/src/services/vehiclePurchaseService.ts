import { supabase } from '../lib/supabase';

export class VehiclePurchaseService {
  static async createCheckout(agreementId: string, amountUSD: number, purpose: 'deposit' | 'balance' | 'full' = 'deposit'): Promise<string | null> {
    const { data, error } = await supabase.functions.invoke('create-vehicle-checkout', {
      body: {
        agreement_id: agreementId,
        amount_usd: amountUSD,
        purpose,
        success_url: `${window.location.origin}/purchase/${agreementId}/payment/success`,
        cancel_url: `${window.location.origin}/purchase/${agreementId}`
      }
    });

    if (error) {
      console.error('Vehicle checkout error:', error);
      return null;
    }

    return data?.checkout_url || null;
  }
}
