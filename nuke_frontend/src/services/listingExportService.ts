/**
 * Listing Export Service
 * Handles export tracking and submission to external platforms
 */

import { supabase } from '../lib/supabase';

export interface ListingExport {
  id: string;
  vehicle_id: string;
  user_id: string;
  platform: 'nzero' | 'bat' | 'ebay' | 'craigslist' | 'carscom' | 'facebook' | 'autotrader' | 'other';
  export_format: 'json' | 'csv' | 'html' | 'text';
  title: string;
  description: string;
  asking_price_cents: number;
  reserve_price_cents?: number;
  exported_images: string[];
  image_count: number;
  status: 'prepared' | 'submitted' | 'active' | 'sold' | 'expired' | 'cancelled';
  external_listing_url?: string;
  external_listing_id?: string;
  submitted_at?: string;
  activated_at?: string;
  ended_at?: string;
  sold_price_cents?: number;
  sold_at?: string;
  commission_cents?: number;
  metadata: any;
  created_at: string;
  updated_at: string;
}

export interface ExportAnalytics {
  total_exports: number;
  by_platform: Record<string, number>;
  by_status: Record<string, number>;
  total_sold: number;
  total_revenue_cents: number;
  total_commission_cents: number;
  conversion_rate: number;
}

export class ListingExportService {
  /**
   * Create a new listing export record
   */
  static async createExport(params: {
    vehicle_id: string;
    platform: string;
    export_format: string;
    title: string;
    description: string;
    asking_price_cents: number;
    reserve_price_cents?: number;
    exported_images: string[];
    metadata?: any;
  }): Promise<{ success: boolean; export_id?: string; error?: string }> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        return { success: false, error: 'Not authenticated' };
      }

      const { data, error } = await supabase
        .from('listing_exports')
        .insert({
          vehicle_id: params.vehicle_id,
          user_id: user.id,
          platform: params.platform,
          export_format: params.export_format,
          title: params.title,
          description: params.description,
          asking_price_cents: params.asking_price_cents,
          reserve_price_cents: params.reserve_price_cents,
          exported_images: params.exported_images,
          image_count: params.exported_images.length,
          status: 'prepared',
          metadata: params.metadata || {}
        })
        .select()
        .single();

      if (error) throw error;

      return { success: true, export_id: data.id };
    } catch (error) {
      console.error('Error creating export:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create export'
      };
    }
  }

  /**
   * Update export status (e.g., when submitted to platform)
   */
  static async updateExportStatus(
    export_id: string,
    status: ListingExport['status'],
    updates?: {
      external_listing_url?: string;
      external_listing_id?: string;
      submitted_at?: string;
      activated_at?: string;
      ended_at?: string;
      sold_price_cents?: number;
      sold_at?: string;
    }
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await supabase
        .from('listing_exports')
        .update({
          status,
          ...updates
        })
        .eq('id', export_id);

      if (error) throw error;

      return { success: true };
    } catch (error) {
      console.error('Error updating export:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update export'
      };
    }
  }

  /**
   * Get all exports for a vehicle
   */
  static async getVehicleExports(vehicle_id: string): Promise<ListingExport[]> {
    try {
      const { data, error } = await supabase
        .from('listing_exports')
        .select('*')
        .eq('vehicle_id', vehicle_id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      return data as ListingExport[];
    } catch (error) {
      console.error('Error fetching vehicle exports:', error);
      return [];
    }
  }

  /**
   * Get all exports for current user
   */
  static async getUserExports(): Promise<ListingExport[]> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      const { data, error } = await supabase
        .from('listing_exports')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      return data as ListingExport[];
    } catch (error) {
      console.error('Error fetching user exports:', error);
      return [];
    }
  }

  /**
   * Get export analytics for current user
   */
  static async getExportAnalytics(): Promise<ExportAnalytics | null> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      const { data, error } = await supabase
        .rpc('get_export_analytics', { p_user_id: user.id });

      if (error) throw error;

      return data as ExportAnalytics;
    } catch (error) {
      console.error('Error fetching export analytics:', error);
      return null;
    }
  }

  /**
   * Get vehicle export history (RPC function)
   */
  static async getVehicleExportHistory(vehicle_id: string): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .rpc('get_vehicle_export_history', { p_vehicle_id: vehicle_id });

      if (error) throw error;

      return data || [];
    } catch (error) {
      console.error('Error fetching vehicle export history:', error);
      return [];
    }
  }

  /**
   * Delete an export
   */
  static async deleteExport(export_id: string): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await supabase
        .from('listing_exports')
        .delete()
        .eq('id', export_id);

      if (error) throw error;

      return { success: true };
    } catch (error) {
      console.error('Error deleting export:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete export'
      };
    }
  }

  /**
   * Create submission template
   */
  static async createTemplate(params: {
    name: string;
    platform: string;
    title_template: string;
    description_template: string;
    default_auction_duration_days?: number;
    max_images?: number;
    is_public?: boolean;
  }): Promise<{ success: boolean; template_id?: string; error?: string }> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        return { success: false, error: 'Not authenticated' };
      }

      const { data, error } = await supabase
        .from('platform_submission_templates')
        .insert({
          user_id: user.id,
          ...params
        })
        .select()
        .single();

      if (error) throw error;

      return { success: true, template_id: data.id };
    } catch (error) {
      console.error('Error creating template:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create template'
      };
    }
  }

  /**
   * Get user's templates
   */
  static async getUserTemplates(platform?: string): Promise<any[]> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      let query = supabase
        .from('platform_submission_templates')
        .select('*')
        .or(`user_id.eq.${user.id},is_public.eq.true`)
        .order('created_at', { ascending: false });

      if (platform) {
        query = query.eq('platform', platform);
      }

      const { data, error } = await query;

      if (error) throw error;

      return data || [];
    } catch (error) {
      console.error('Error fetching templates:', error);
      return [];
    }
  }

  /**
   * Platform-specific submission helpers
   */

  /**
   * Format listing for Bring a Trailer
   */
  static formatForBaT(listing: {
    title: string;
    description: string;
    images: string[];
    price: number;
  }): string {
    // BaT prefers detailed, story-driven descriptions
    // Format with proper sections
    return `${listing.title}

${listing.description}

Asking Price: $${listing.price.toLocaleString()}

Please contact for additional information and viewing arrangements.

${listing.images.length} photos available`;
  }

  /**
   * Format listing for eBay Motors
   */
  static formatForEbay(listing: {
    title: string;
    description: string;
    images: string[];
    price: number;
    specs: Record<string, any>;
  }): string {
    // eBay prefers structured HTML
    const specsList = Object.entries(listing.specs)
      .map(([key, value]) => `<li><strong>${key}:</strong> ${value}</li>`)
      .join('\n');

    return `<div class="ebay-listing">
  <h1>${listing.title}</h1>
  
  <div class="description">
    ${listing.description.replace(/\n/g, '<br/>')}
  </div>
  
  <h2>Specifications</h2>
  <ul>
    ${specsList}
  </ul>
  
  <h2>Price</h2>
  <p class="price">$${listing.price.toLocaleString()}</p>
  
  <h2>Photos</h2>
  <p>${listing.images.length} high-resolution photos available</p>
</div>`;
  }

  /**
   * Format listing for Craigslist
   */
  static formatForCraigslist(listing: {
    title: string;
    description: string;
    price: number;
    location: string;
  }): string {
    // Craigslist prefers plain text, concise
    return `${listing.title} - $${listing.price.toLocaleString()}

${listing.description}

Location: ${listing.location}

Serious inquiries only. No trades.`;
  }
}

