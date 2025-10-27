import { supabase } from '../lib/supabase';

export type { VehicleTransaction };

export interface VehicleTransaction {
  id: string;
  vehicle_id: string;
  buyer_id: string;
  seller_id: string;
  sale_price: number;
  facilitation_fee_pct: number;
  facilitation_fee_amount: number;
  status: string;
  buyer_signed_at?: string;
  seller_signed_at?: string;
  buyer_sign_token: string;
  seller_sign_token: string;
  purchase_agreement_url?: string;
  bill_of_sale_url?: string;
  vehicle?: any;
  buyer?: any;
  seller?: any;
}

/**
 * Create a vehicle transaction and get Stripe checkout URL
 */
export async function createVehicleTransaction(
  vehicleId: string,
  salePrice: number,
  feePercentage: number = 2.0,
  buyerPhone?: string
): Promise<{ checkoutUrl: string; transactionId: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  
  if (!session) {
    throw new Error('Must be logged in to purchase vehicle');
  }

  const response = await supabase.functions.invoke('create-vehicle-transaction-checkout', {
    body: {
      vehicle_id: vehicleId,
      sale_price: salePrice,
      fee_percentage: feePercentage,
      buyer_phone: buyerPhone,
      buyer_email: session.user.email
    }
  });

  if (response.error) {
    throw new Error(response.error.message || 'Failed to create checkout');
  }

  return {
    checkoutUrl: response.data.checkout_url,
    transactionId: response.data.transaction_id
  };
}

/**
 * Get transaction details by token (for signing)
 */
export async function getTransactionByToken(
  token: string,
  userType: 'buyer' | 'seller'
): Promise<VehicleTransaction | null> {
  const column = userType === 'buyer' ? 'buyer_sign_token' : 'seller_sign_token';
  
  const { data, error } = await supabase
    .from('vehicle_transactions')
    .select(`
      *,
      vehicle:vehicles(*),
      buyer:buyer_id(id, email, raw_user_meta_data),
      seller:seller_id(id, email, raw_user_meta_data)
    `)
    .eq(column, token)
    .single();

  if (error || !data) {
    return null;
  }

  return data as VehicleTransaction;
}

/**
 * Submit signature for a transaction
 */
export async function submitSignature(
  token: string,
  userType: 'buyer' | 'seller',
  signatureData: string,
  ipAddress?: string
): Promise<{ success: boolean; fullySigned?: boolean }> {
  // Get transaction first
  const transaction = await getTransactionByToken(token, userType);
  
  if (!transaction) {
    throw new Error('Transaction not found');
  }

  const updates: any = {
    [`${userType}_signature_data`]: signatureData,
    [`${userType}_signed_at`]: new Date().toISOString()
  };

  if (ipAddress) {
    updates[`${userType}_signature_ip`] = ipAddress;
  }

  const { error } = await supabase
    .from('vehicle_transactions')
    .update(updates)
    .eq('id', transaction.id);

  if (error) {
    throw new Error('Failed to submit signature');
  }

  // Check if both signed
  const otherUserType = userType === 'buyer' ? 'seller' : 'buyer';
  const otherSigned = transaction[`${otherUserType}_signed_at`];
  const fullySigned = !!otherSigned;

  // If fully signed, trigger completion SMS and shipping
  if (fullySigned) {
    // Send completion SMS
    await supabase.functions.invoke('send-transaction-sms', {
      body: {
        transaction_id: transaction.id,
        notification_type: 'completion'
      }
    });

    // Auto-create shipping listing
    try {
      await supabase.functions.invoke('create-shipping-listing', {
        body: {
          transaction_id: transaction.id
        }
      });
      console.log('Shipping listing creation triggered');
    } catch (err) {
      console.error('Failed to create shipping listing:', err);
      // Don't fail signature submission if shipping fails
    }
  }

  return { success: true, fullySigned };
}

/**
 * Get user's transactions
 */
export async function getUserTransactions(
  userId: string
): Promise<VehicleTransaction[]> {
  const { data, error } = await supabase
    .from('vehicle_transactions')
    .select(`
      *,
      vehicle:vehicles(year, make, model, vehicle_number),
      buyer:buyer_id(raw_user_meta_data),
      seller:seller_id(raw_user_meta_data)
    `)
    .or(`buyer_id.eq.${userId},seller_id.eq.${userId}`)
    .order('created_at', { ascending: false });

  if (error) {
    throw error;
  }

  return (data as VehicleTransaction[]) || [];
}

/**
 * Mark transaction funds as received (seller only)
 */
export async function markFundsReceived(
  transactionId: string
): Promise<void> {
  const { error } = await supabase
    .from('vehicle_transactions')
    .update({ 
      status: 'funds_transferred',
      metadata: { funds_received_at: new Date().toISOString() }
    })
    .eq('id', transactionId);

  if (error) {
    throw error;
  }
}

/**
 * Complete transaction (transfer vehicle ownership)
 */
export async function completeTransaction(
  transactionId: string
): Promise<void> {
  const transaction = await supabase
    .from('vehicle_transactions')
    .select('*, vehicle:vehicles(*)')
    .eq('id', transactionId)
    .single();

  if (!transaction.data) {
    throw new Error('Transaction not found');
  }

  // Transfer vehicle ownership
  await supabase
    .from('vehicles')
    .update({ user_id: transaction.data.buyer_id })
    .eq('id', transaction.data.vehicle_id);

  // Mark transaction complete
  await supabase
    .from('vehicle_transactions')
    .update({ status: 'completed' })
    .eq('id', transactionId);
}

