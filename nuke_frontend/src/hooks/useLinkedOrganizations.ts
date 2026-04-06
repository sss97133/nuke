import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { LinkedOrg } from '../components/vehicle/LinkedOrganizations';

export function useLinkedOrganizations(vehicleId: string, initialOrganizations?: LinkedOrg[]) {
  return useQuery({
    queryKey: ['linked-organizations', vehicleId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organization_vehicles')
        .select(`
          id,
          organization_id,
          relationship_type,
          auto_tagged,
          gps_match_confidence,
          status,
          businesses!inner (
            id,
            business_name,
            business_type,
            city,
            state,
            logo_url
          )
        `)
        .eq('vehicle_id', vehicleId)
        .in('status', ['active', 'sold', 'pending', 'past', 'archived']);

      if (error) throw error;

      return (data || []).map((ov: any) => ({
        id: ov.id,
        organization_id: ov.organization_id,
        relationship_type: ov.relationship_type,
        auto_tagged: ov.auto_tagged,
        gps_match_confidence: ov.gps_match_confidence,
        status: ov.status,
        business_name: ov.businesses.business_name,
        business_type: ov.businesses.business_type,
        city: ov.businesses.city,
        state: ov.businesses.state,
        logo_url: ov.businesses.logo_url
      })) as LinkedOrg[];
    },
    enabled: !!vehicleId && initialOrganizations === undefined,
    staleTime: 5 * 60 * 1000,
    initialData: initialOrganizations,
  });
}
