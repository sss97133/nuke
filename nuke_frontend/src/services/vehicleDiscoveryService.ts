// Vehicle Discovery Service
import { supabase } from '../lib/supabase';
import type { VehicleStatusMetadata, ContributionRequest } from '../types/vehicleDiscovery';

export class VehicleDiscoveryService {
  // Fetch vehicle metadata for discovery features
  static async getVehicleMetadata(vehicleId: string): Promise<VehicleStatusMetadata | null> {
    try {
      const { data, error } = await supabase
        .from('vehicle_status_metadata')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('Error fetching vehicle metadata:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('Error in getVehicleMetadata:', error);
      return null;
    }
  }

  // Fetch metadata for multiple vehicles
  static async getMultipleVehicleMetadata(vehicleIds: string[]): Promise<Record<string, VehicleStatusMetadata>> {
    try {
      const { data, error } = await supabase
        .from('vehicle_status_metadata')
        .select('*')
        .in('vehicle_id', vehicleIds);

      if (error) {
        console.error('Error fetching multiple vehicle metadata:', error);
        return {};
      }

      // Convert array to object keyed by vehicle_id
      const metadataMap: Record<string, VehicleStatusMetadata> = {};
      (data || []).forEach(item => {
        metadataMap[item.vehicle_id] = item;
      });

      return metadataMap;
    } catch (error) {
      console.error('Error in getMultipleVehicleMetadata:', error);
      return {};
    }
  }

  // Track vehicle view
  static async trackVehicleView(vehicleId: string, duration?: number): Promise<void> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      await supabase
        .from('vehicle_views')
        .insert({
          vehicle_id: vehicleId,
          viewer_id: user?.id || null,
          viewer_session_id: sessionStorage.getItem('session_id') || crypto.randomUUID(),
          view_duration_seconds: duration || null,
          referrer: document.referrer || null
        });

      // Trigger metadata update
      await this.refreshVehicleMetadata(vehicleId);
    } catch (error) {
      console.error('Error tracking vehicle view:', error);
    }
  }

  // Get active contribution requests for a vehicle
  static async getContributionRequests(vehicleId: string): Promise<ContributionRequest[]> {
    try {
      const { data, error } = await supabase
        .from('vehicle_contribution_requests')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .eq('is_active', true)
        .order('priority', { ascending: false })
        .order('created_at', { ascending: true });

      if (error) {
        console.error('Error fetching contribution requests:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Error in getContributionRequests:', error);
      return [];
    }
  }

  // Create a contribution request (for vehicle owners)
  static async createContributionRequest(
    vehicleId: string,
    requestType: string,
    description: string,
    priority: 'low' | 'medium' | 'high' = 'medium'
  ): Promise<boolean> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return false;

      const { error } = await supabase
        .from('vehicle_contribution_requests')
        .insert({
          vehicle_id: vehicleId,
          owner_id: user.id,
          request_type: requestType,
          description,
          priority
        });

      if (error) {
        console.error('Error creating contribution request:', error);
        return false;
      }

      // Update metadata to reflect open contributions
      await this.refreshVehicleMetadata(vehicleId);
      return true;
    } catch (error) {
      console.error('Error in createContributionRequest:', error);
      return false;
    }
  }

  // Mark contribution request as fulfilled
  static async fulfillContributionRequest(requestId: string): Promise<boolean> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return false;

      const { error } = await supabase
        .from('vehicle_contribution_requests')
        .update({
          is_active: false,
          fulfilled_at: new Date().toISOString(),
          fulfilled_by: user.id
        })
        .eq('id', requestId);

      if (error) {
        console.error('Error fulfilling contribution request:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error in fulfillContributionRequest:', error);
      return false;
    }
  }

  // Refresh vehicle metadata (triggers database function)
  static async refreshVehicleMetadata(vehicleId: string): Promise<void> {
    try {
      const { error } = await supabase
        .rpc('update_vehicle_status_metadata', { v_id: vehicleId });

      if (error) {
        console.error('Error refreshing vehicle metadata:', error);
      }
    } catch (error) {
      console.error('Error in refreshVehicleMetadata:', error);
    }
  }

  // Get vehicles needing contributions
  static async getVehiclesNeedingContributions(
    type?: 'photos' | 'specifications' | 'history' | 'verification'
  ): Promise<any[]> {
    try {
      let query = supabase
        .from('vehicle_status_metadata')
        .select(`
          vehicle_id,
          status,
          data_completeness_score,
          verification_level,
          needs_photos,
          needs_specifications,
          needs_history,
          needs_verification,
          owner_seeking_info,
          vehicles!inner(
            id,
            make,
            model,
            year,
            primary_image_url
          )
        `);

      // Filter by specific need type if provided
      if (type === 'photos') {
        query = query.eq('needs_photos', true);
      } else if (type === 'specifications') {
        query = query.eq('needs_specifications', true);
      } else if (type === 'history') {
        query = query.eq('needs_history', true);
      } else if (type === 'verification') {
        query = query.eq('needs_verification', true);
      } else {
        // Get any vehicles needing contributions
        query = query.or(
          'needs_photos.eq.true,needs_specifications.eq.true,needs_history.eq.true,needs_verification.eq.true,owner_seeking_info.eq.true'
        );
      }

      const { data, error } = await query
        .order('data_completeness_score', { ascending: true })
        .limit(20);

      if (error) {
        console.error('Error fetching vehicles needing contributions:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Error in getVehiclesNeedingContributions:', error);
      return [];
    }
  }

  // Get trending vehicles (high activity)
  static async getTrendingVehicles(): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('vehicle_status_metadata')
        .select(`
          vehicle_id,
          status,
          activity_heat_score,
          views_this_week,
          contributor_count,
          verification_level,
          vehicles!inner(
            id,
            make,
            model,
            year,
            primary_image_url
          )
        `)
        .gt('activity_heat_score', 60)
        .order('activity_heat_score', { ascending: false })
        .limit(10);

      if (error) {
        console.error('Error fetching trending vehicles:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Error in getTrendingVehicles:', error);
      return [];
    }
  }
}
