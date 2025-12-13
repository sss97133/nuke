import { supabase } from '../lib/supabase';
import type { 
  Business, 
  BusinessFormData, 
  BusinessOwnership, 
  BusinessUserRole, 
  BusinessVehicleFleet,
  BusinessTimelineEvent 
} from '../types/business';

export class BusinessService {
  
  /**
   * Create a new business
   */
  static async createBusiness(businessData: BusinessFormData): Promise<Business> {
    const { data, error } = await supabase
      .from('businesses')
      .insert([businessData])
      .select()
      .single();

    if (error) {
      console.error('Error creating business:', error);
      throw new Error(`Failed to create business: ${error.message}`);
    }

    return data;
  }

  /**
   * Get business by ID
   */
  static async getBusinessById(businessId: string): Promise<Business | null> {
    const { data, error } = await supabase
      .from('businesses')
      .select('*')
      .eq('id', businessId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null; // No rows returned
      }
      console.error('Error fetching business:', error);
      throw new Error(`Failed to fetch business: ${error.message}`);
    }

    return data;
  }

  /**
   * Get businesses owned by current user
   */
  static async getUserBusinesses(): Promise<Business[]> {
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      throw new Error('User not authenticated');
    }

    // Get businesses through ownership table
    const { data, error } = await supabase
      .from('businesses')
      .select(`
        *,
        business_ownership!inner(
          ownership_percentage,
          ownership_type,
          ownership_title
        )
      `)
      .eq('business_ownership.owner_id', user.id)
      .eq('business_ownership.status', 'active');

    if (error) {
      console.error('Error fetching user businesses:', error);
      throw new Error(`Failed to fetch businesses: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Update business
   */
  static async updateBusiness(businessId: string, updates: Partial<BusinessFormData>): Promise<Business> {
    const { data, error } = await supabase
      .from('businesses')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', businessId)
      .select()
      .single();

    if (error) {
      console.error('Error updating business:', error);
      throw new Error(`Failed to update business: ${error.message}`);
    }

    return data;
  }

  /**
   * Delete business
   */
  static async deleteBusiness(businessId: string): Promise<void> {
    const { error } = await supabase
      .from('businesses')
      .delete()
      .eq('id', businessId);

    if (error) {
      console.error('Error deleting business:', error);
      throw new Error(`Failed to delete business: ${error.message}`);
    }
  }

  /**
   * Get business ownership details
   */
  static async getBusinessOwnership(businessId: string): Promise<BusinessOwnership[]> {
    const { data, error } = await supabase
      .from('business_ownership')
      .select(`
        *,
        profiles:owner_id(
          full_name,
          email,
          avatar_url
        )
      `)
      .eq('business_id', businessId)
      .eq('status', 'active');

    if (error) {
      console.error('Error fetching business ownership:', error);
      throw new Error(`Failed to fetch ownership: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Add user role to business
   */
  static async addUserRole(businessId: string, roleData: Omit<BusinessUserRole, 'id' | 'created_at' | 'updated_at'>): Promise<BusinessUserRole> {
    const { data, error } = await supabase
      .from('business_user_roles')
      .insert([{ ...roleData, business_id: businessId }])
      .select()
      .single();

    if (error) {
      console.error('Error adding user role:', error);
      throw new Error(`Failed to add user role: ${error.message}`);
    }

    return data;
  }

  /**
   * Get business team members
   */
  static async getBusinessTeam(businessId: string): Promise<BusinessUserRole[]> {
    const { data, error } = await supabase
      .from('business_user_roles')
      .select(`
        *,
        profiles:user_id(
          full_name,
          email,
          avatar_url,
          username
        )
      `)
      .eq('business_id', businessId)
      .eq('status', 'active');

    if (error) {
      console.error('Error fetching business team:', error);
      throw new Error(`Failed to fetch team: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Add vehicle to business fleet
   */
  static async addVehicleToFleet(fleetData: Omit<BusinessVehicleFleet, 'id' | 'created_at' | 'updated_at' | 'added_to_fleet'>): Promise<BusinessVehicleFleet> {
    const { data, error } = await supabase
      .from('business_vehicle_fleet')
      .insert([fleetData])
      .select()
      .single();

    if (error) {
      console.error('Error adding vehicle to fleet:', error);
      throw new Error(`Failed to add vehicle to fleet: ${error.message}`);
    }

    return data;
  }

  /**
   * Get business vehicle fleet
   */
  static async getBusinessFleet(businessId: string): Promise<BusinessVehicleFleet[]> {
    const { data, error } = await supabase
      .from('business_vehicle_fleet')
      .select(`
        *,
        vehicles:vehicle_id(
          make,
          model,
          year,
          vin,
          color,
          mileage
        )
      `)
      .eq('business_id', businessId)
      .eq('status', 'active');

    if (error) {
      console.error('Error fetching business fleet:', error);
      throw new Error(`Failed to fetch fleet: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Create business timeline event
   */
  static async createTimelineEvent(eventData: Omit<BusinessTimelineEvent, 'id' | 'created_at' | 'updated_at'>): Promise<BusinessTimelineEvent> {
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      throw new Error('User not authenticated');
    }

    const { data, error } = await supabase
      .from('business_timeline_events')
      .insert([{ ...eventData, created_by: user.id }])
      .select()
      .single();

    if (error) {
      console.error('Error creating timeline event:', error);
      throw new Error(`Failed to create timeline event: ${error.message}`);
    }

    return data;
  }

  /**
   * Get business timeline events
   */
  static async getBusinessTimeline(businessId: string): Promise<BusinessTimelineEvent[]> {
    const { data, error } = await supabase
      .from('business_timeline_events')
      .select(`
        *,
        profiles:created_by(
          full_name,
          avatar_url
        )
      `)
      .eq('business_id', businessId)
      .order('event_date', { ascending: false });

    if (error) {
      console.error('Error fetching business timeline:', error);
      throw new Error(`Failed to fetch timeline: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Search businesses (public)
   */
  static async searchBusinesses(query: string, filters: {
    business_type?: string;
    city?: string;
    state?: string;
    specializations?: string[];
  } = {}): Promise<Business[]> {
    const escapeILike = (s: string) => String(s || '').replace(/([%_\\])/g, '\\$1');
    let queryBuilder = supabase
      .from('businesses')
      .select('*')
      .eq('is_public', true)
      .eq('is_verified', true)
      .eq('status', 'active');

    // Text search
    if (query) {
      const querySafe = escapeILike(query);
      queryBuilder = queryBuilder.or(`business_name.ilike.%${querySafe}%,description.ilike.%${querySafe}%`);
    }

    // Filters
    if (filters.business_type) {
      queryBuilder = queryBuilder.eq('business_type', filters.business_type);
    }

    if (filters.city) {
      queryBuilder = queryBuilder.eq('city', filters.city);
    }

    if (filters.state) {
      queryBuilder = queryBuilder.eq('state', filters.state);
    }

    if (filters.specializations && filters.specializations.length > 0) {
      queryBuilder = queryBuilder.overlaps('specializations', filters.specializations);
    }

    const { data, error } = await queryBuilder
      .order('average_project_rating', { ascending: false })
      .limit(50);

    if (error) {
      console.error('Error searching businesses:', error);
      throw new Error(`Failed to search businesses: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Get business statistics
   */
  static async getBusinessStats(businessId: string): Promise<{
    totalProjects: number;
    totalVehicles: number;
    totalRevenue: number;
    averageRating: number;
    completionRate: number;
  }> {
    // This would typically involve multiple queries or a stored procedure
    // For now, return basic stats from the business record
    const business = await this.getBusinessById(businessId);
    
    if (!business) {
      throw new Error('Business not found');
    }

    return {
      totalProjects: business.total_projects_completed,
      totalVehicles: business.total_vehicles_worked,
      totalRevenue: 0, // Would need to calculate from fleet/projects
      averageRating: business.average_project_rating,
      completionRate: business.on_time_completion_rate
    };
  }

  /**
   * Transfer business ownership
   */
  static async transferOwnership(businessId: string, newOwnerId: string, ownershipPercentage: number): Promise<BusinessOwnership> {
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      throw new Error('User not authenticated');
    }

    // This would typically be a more complex transaction
    // For now, create new ownership record
    const { data, error } = await supabase
      .from('business_ownership')
      .insert([{
        business_id: businessId,
        owner_id: newOwnerId,
        ownership_percentage: ownershipPercentage,
        ownership_type: 'acquired',
        acquisition_date: new Date().toISOString().split('T')[0]
      }])
      .select()
      .single();

    if (error) {
      console.error('Error transferring ownership:', error);
      throw new Error(`Failed to transfer ownership: ${error.message}`);
    }

    return data;
  }
}
