import { supabase } from '../lib/supabase';

export type { ShippingEvent };

export interface ShippingEvent {
  id: string;
  transaction_id: string;
  listing_id: string;
  event_type: string;
  event_data: any;
  carrier_info?: any;
  created_at: string;
}

/**
 * Get shipping events for a transaction
 */
export async function getShippingEvents(transactionId: string): Promise<ShippingEvent[]> {
  const { data, error } = await supabase
    .from('shipping_events')
    .select('*')
    .eq('transaction_id', transactionId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Failed to load shipping events:', error);
    return [];
  }

  return data || [];
}

/**
 * Get shipping status for a transaction
 */
export async function getShippingStatus(transactionId: string) {
  const { data, error } = await supabase
    .from('vehicle_transactions')
    .select(`
      shipping_listing_id,
      shipping_status,
      shipping_carrier_name,
      shipping_carrier_phone,
      shipping_carrier_email,
      shipping_pickup_date,
      shipping_delivery_date,
      shipping_estimated_cost,
      shipping_actual_cost,
      shipping_tracking_url,
      pickup_address,
      delivery_address
    `)
    .eq('id', transactionId)
    .single();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Manually create shipping listing (admin/seller)
 */
export async function createShippingListing(transactionId: string): Promise<any> {
  const { data, error } = await supabase.functions.invoke('create-shipping-listing', {
    body: { transaction_id: transactionId }
  });

  if (error) {
    throw new Error(error.message || 'Failed to create shipping listing');
  }

  return data;
}

/**
 * Check Central Dispatch connection status
 */
export async function checkCentralDispatchConnection(): Promise<{
  connected: boolean;
  test_mode: boolean;
  expires_at?: string;
}> {
  const { data, error } = await supabase
    .from('platform_integrations')
    .select('*')
    .eq('integration_name', 'central_dispatch')
    .single();

  if (error || !data) {
    return { connected: false, test_mode: false };
  }

  return {
    connected: data.status === 'connected',
    test_mode: data.metadata?.test_mode || false,
    expires_at: data.token_expires_at
  };
}

/**
 * Get Central Dispatch authorization URL (admin setup)
 */
export async function getCentralDispatchAuthUrl(): Promise<string> {
  const { data, error } = await supabase.functions.invoke('get-centraldispatch-auth-url');

  if (error || !data?.auth_url) {
    throw new Error('Failed to get authorization URL');
  }

  return data.auth_url;
}

