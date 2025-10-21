import { supabase } from '../lib/supabase';

export class SharePurchaseService {
  static async createCheckout(offeringId: string, shares: number): Promise<string | null> {
    const { data, error } = await supabase.functions.invoke('create-share-checkout', {
      body: {
        offering_id: offeringId,
        shares,
        success_url: `${window.location.origin}/market/checkout/success`,
        cancel_url: `${window.location.origin}/market/checkout/cancel`
      }
    });

    if (error) {
      console.error('Share checkout error:', error);
      return null;
    }

    return data?.checkout_url || null;
  }
}
