/**
 * My Organizations Service
 * Handles loading and managing user's organizational affiliations
 */

import { supabase } from '../lib/supabase';

export interface MyOrganization {
  id: string;
  organization_id: string;
  organization: {
    id: string;
    business_name: string;
    business_type: string;
    logo_url?: string;
    is_verified: boolean;
  };
  role: string;
  status: string;
  start_date: string;
  end_date?: string;
  contribution_count: number;
  stats?: {
    vehicle_count: number;
    in_stock_count: number;
    total_value: number;
    last_activity_at?: string;
  };
  preferences?: {
    is_pinned: boolean;
    display_order: number;
  };
}

export interface OrganizationStats {
  vehicle_count: number;
  in_stock_count: number;
  sold_count: number;
  total_value: number;
  contribution_count: number;
  last_activity_at?: string;
  team_member_count: number;
}

export class MyOrganizationsService {
  /**
   * Get all organizations for current user
   */
  static async getMyOrganizations(filters?: {
    status?: 'active' | 'inactive' | 'all';
    role?: string;
    sortBy?: 'recent' | 'name' | 'value' | 'contributions';
  }): Promise<MyOrganization[]> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      let query = supabase
        .from('organization_contributors')
        .select(`
          id,
          organization_id,
          role,
          status,
          start_date,
          end_date,
          contribution_count,
          businesses!inner(
            id,
            business_name,
            business_type,
            logo_url,
            is_verified
          )
        `)
        .eq('user_id', user.id);

      // Apply status filter
      if (filters?.status && filters.status !== 'all') {
        query = query.eq('status', filters.status);
      }

      // Apply role filter
      if (filters?.role) {
        query = query.eq('role', filters.role);
      }

      // Apply sorting - PostgREST doesn't support ordering by nested columns (businesses.business_name)
      // So we'll do in-memory sorting for 'name', but use PostgREST for other sorts
      switch (filters?.sortBy) {
        case 'contributions':
          query = query.order('contribution_count', { ascending: false });
          break;
        case 'recent':
        default:
          query = query.order('start_date', { ascending: false });
          break;
        // 'name' will be sorted in memory after fetching
      }

      const { data, error } = await query;
      
      if (error) {
        console.error('Error fetching organizations:', error);
        return [];
      }

      if (!data || data.length === 0) {
        return [];
      }

      // Sort in memory for nested column ordering (businesses.business_name)
      if (filters?.sortBy === 'name') {
        data.sort((a, b) => {
          const aName = a.businesses?.business_name || '';
          const bName = b.businesses?.business_name || '';
          return aName.localeCompare(bName);
        });
      }

      // Load stats for each organization and transform data structure
      const organizationsWithStats = await Promise.all(
        (data || []).map(async (affiliation: any) => {
          // Skip if businesses data is missing (shouldn't happen with inner join, but safety check)
          if (!affiliation.businesses) {
            console.warn('[MyOrganizationsService] Missing businesses data for affiliation:', affiliation.id);
            return null;
          }

          const stats = await this.getOrganizationStats(affiliation.organization_id);
          const preferences = await this.getOrganizationPreferences(affiliation.organization_id);

          return {
            id: affiliation.id,
            organization_id: affiliation.organization_id,
            organization: {
              id: affiliation.businesses.id,
              business_name: affiliation.businesses.business_name,
              business_type: affiliation.businesses.business_type,
              logo_url: affiliation.businesses.logo_url,
              is_verified: affiliation.businesses.is_verified || false,
            },
            role: affiliation.role,
            status: affiliation.status,
            start_date: affiliation.start_date,
            end_date: affiliation.end_date,
            contribution_count: affiliation.contribution_count || 0,
            stats,
            preferences,
          } as MyOrganization;
        })
      );

      // Filter out any null entries (from missing businesses data)
      const validOrgs = organizationsWithStats.filter(org => org !== null) as MyOrganization[];

      // Sort by value if requested (after loading stats)
      if (filters?.sortBy === 'value') {
        validOrgs.sort((a, b) => 
          (b.stats?.total_value || 0) - (a.stats?.total_value || 0)
        );
      }

      return validOrgs;
    } catch (error) {
      console.error('Error loading my organizations:', error);
      return [];
    }
  }

  /**
   * Get stats for an organization
   */
  static async getOrganizationStats(organizationId: string): Promise<OrganizationStats> {
    try {
      // Get vehicle count and value
      const { data: vehicles, error: vehiclesError } = await supabase
        .from('organization_vehicles')
        .select(`
          relationship_type,
          vehicles!inner(
            id,
            current_value
          )
        `)
        .eq('organization_id', organizationId);

      if (vehiclesError) throw vehiclesError;

      const vehicleCount = vehicles?.length || 0;
      const inStockCount = vehicles?.filter((v: any) => v.relationship_type === 'in_stock').length || 0;
      const soldCount = vehicles?.filter((v: any) => v.relationship_type === 'sold').length || 0;
      const totalValue = vehicles?.reduce((sum: number, v: any) => 
        sum + (v.vehicles?.current_value || 0), 0
      ) || 0;

      // Get contribution count and last activity
      const { data: events, error: eventsError } = await supabase
        .from('timeline_events')
        .select('id, created_at')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false })
        .limit(1);

      const contributionCount = events?.length || 0;
      const lastActivityAt = events?.[0]?.created_at;

      // Get team member count
      const { count: teamCount, error: teamError } = await supabase
        .from('organization_contributors')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .eq('status', 'active');

      return {
        vehicle_count: vehicleCount,
        in_stock_count: inStockCount,
        sold_count: soldCount,
        total_value: totalValue,
        contribution_count: contributionCount,
        last_activity_at: lastActivityAt,
        team_member_count: teamCount || 0,
      };
    } catch (error) {
      console.error('Error loading organization stats:', error);
      return {
        vehicle_count: 0,
        in_stock_count: 0,
        sold_count: 0,
        total_value: 0,
        contribution_count: 0,
        team_member_count: 0,
      };
    }
  }

  /**
   * Get organization preferences for current user
   */
  static async getOrganizationPreferences(organizationId: string): Promise<{
    is_pinned: boolean;
    display_order: number;
  }> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return { is_pinned: false, display_order: 0 };

      const { data, error } = await supabase
        .from('user_organization_preferences')
        .select('is_pinned, display_order')
        .eq('user_id', user.id)
        .eq('organization_id', organizationId)
        .maybeSingle();

      // Handle missing table (PGRST116), 404 Not Found, or RLS blocking access
      if (error && error.code !== 'PGRST116' && error.code !== 'PGRST301' && error.status !== 404) {
        // Only throw if it's a real error, not a missing resource
        throw error;
      }

      return {
        is_pinned: data?.is_pinned || false,
        display_order: data?.display_order || 0,
      };
    } catch (error: any) {
      // Only log real errors, not missing table/404/RLS issues
      if (error?.code !== 'PGRST116' && error?.code !== 'PGRST301' && error?.status !== 404) {
        console.error('Error loading organization preferences:', error);
      }
      return { is_pinned: false, display_order: 0 };
    }
  }

  /**
   * Update affiliation role/status
   */
  static async updateAffiliation(
    affiliationId: string,
    updates: { role?: string; status?: string }
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await supabase
        .from('organization_contributors')
        .update(updates)
        .eq('id', affiliationId);

      if (error) throw error;

      return { success: true };
    } catch (error) {
      console.error('Error updating affiliation:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update affiliation',
      };
    }
  }

  /**
   * Pin/unpin organization
   */
  static async togglePin(
    organizationId: string,
    isPinned: boolean
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        return { success: false, error: 'Not authenticated' };
      }

      // Check if preference exists
      const { data: existing } = await supabase
        .from('user_organization_preferences')
        .select('id')
        .eq('user_id', user.id)
        .eq('organization_id', organizationId)
        .maybeSingle();

      if (existing) {
        // Update existing
        const { error } = await supabase
          .from('user_organization_preferences')
          .update({ is_pinned: isPinned })
          .eq('id', existing.id);

        if (error) throw error;
      } else {
        // Create new
        const { error } = await supabase
          .from('user_organization_preferences')
          .insert({
            user_id: user.id,
            organization_id: organizationId,
            is_pinned: isPinned,
            display_order: 0,
          });

        if (error) throw error;
      }

      return { success: true };
    } catch (error) {
      console.error('Error toggling pin:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to toggle pin',
      };
    }
  }

  /**
   * Get summary stats for all organizations
   */
  static async getSummaryStats(): Promise<{
    total_organizations: number;
    active_organizations: number;
    total_vehicles: number;
    total_value: number;
    total_contributions: number;
  }> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        return {
          total_organizations: 0,
          active_organizations: 0,
          total_vehicles: 0,
          total_value: 0,
          total_contributions: 0,
        };
      }

      const organizations = await this.getMyOrganizations({ status: 'all' });
      const activeOrgs = organizations.filter(o => o.status === 'active');

      let totalVehicles = 0;
      let totalValue = 0;
      let totalContributions = 0;

      for (const org of organizations) {
        if (org.stats) {
          totalVehicles += org.stats.vehicle_count;
          totalValue += org.stats.total_value;
        }
        totalContributions += org.contribution_count;
      }

      return {
        total_organizations: organizations.length,
        active_organizations: activeOrgs.length,
        total_vehicles: totalVehicles,
        total_value: totalValue,
        total_contributions: totalContributions,
      };
    } catch (error) {
      console.error('Error loading summary stats:', error);
      return {
        total_organizations: 0,
        active_organizations: 0,
        total_vehicles: 0,
        total_value: 0,
        total_contributions: 0,
      };
    }
  }
}



