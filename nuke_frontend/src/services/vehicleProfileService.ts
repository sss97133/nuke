import { supabase } from '../lib/supabase';
import type { Vehicle, SaleSettings } from '../pages/vehicle-profile/types';

export const fetchVehicle = async (vehicleId: string): Promise<Vehicle | null> => {
  const { data, error } = await supabase
    .from('vehicles')
    .select('*')
    .eq('id', vehicleId)
    .single();
  
  if (error) throw error;
  return data;
};

export const fetchVehicleImages = async (vehicleId: string): Promise<string[]> => {
  const { data, error } = await supabase
    .from('vehicle_images')
    .select('image_url')
    .eq('vehicle_id', vehicleId)
    .order('is_primary', { ascending: false })
    .order('position', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data || []).map(d => d.image_url);
};

export const fetchSaleSettings = async (vehicleId: string): Promise<SaleSettings> => {
  const { data } = await supabase
    .from('vehicle_sale_settings')
    .select('*')
    .eq('vehicle_id', vehicleId)
    .maybeSingle();

  if (data) {
    return {
      for_sale: !!data.for_sale,
      live_auction: !!data.live_auction,
      partners: Array.isArray(data.partners) ? data.partners : [],
      reserve: typeof data.reserve === 'number' ? data.reserve : ''
    };
  }
  
  // Default settings if none exist
  return {
    for_sale: false,
    live_auction: false,
    partners: [],
    reserve: ''
  };
};

export const fetchLinkedOrgs = async (vehicleId: string) => {
  const { data } = await supabase
    .from('organization_vehicles')
    .select(`
      id,
      organization_id,
      relationship_type,
      auto_tagged,
      gps_match_confidence,
      businesses (
        id,
        business_name,
        business_type,
        city,
        state,
        logo_url
      )
    `)
    .eq('vehicle_id', vehicleId)
    .eq('status', 'active');
    
  return (data || []).map((item: any) => ({
    id: item.id,
    organization_id: item.organization_id,
    relationship_type: item.relationship_type,
    auto_tagged: item.auto_tagged,
    gps_match_confidence: item.gps_match_confidence,
    business_name: item.businesses?.business_name || '',
    business_type: item.businesses?.business_type,
    city: item.businesses?.city,
    state: item.businesses?.state,
    logo_url: item.businesses?.logo_url
  }));
};

