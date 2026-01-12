/**
 * My Auctions Service
 * Handles loading and managing user's vehicle listings across all platforms
 */

import { supabase } from '../lib/supabase';

export interface UnifiedListing {
  listing_source: 'native' | 'external' | 'export';
  listing_id: string;
  vehicle_id: string;
  user_id: string;
  platform: string;
  listing_status: string;
  // Attribution / access context (prevents false "I profited from this" assumptions)
  scope?: 'personal' | 'organization';
  organization_id?: string;
  organization_name?: string;
  access_role?: string; // user's role in org (e.g. board_member)
  // Platform-specific metadata (public data, used for UI enrichment)
  metadata?: any;
  // Participants (best-effort; may be missing depending on scrape coverage)
  seller_username?: string;
  buyer_username?: string;
  seller_bat_user_id?: string;
  buyer_bat_user_id?: string;
  seller_nzero_user_id?: string;
  buyer_nzero_user_id?: string;
  current_bid?: number;
  reserve_price?: number;
  bid_count?: number;
  view_count?: number;
  watcher_count?: number;
  end_date?: string;
  sold_at?: string;
  final_price?: number;
  external_url?: string;
  listed_at: string;
  last_updated: string;
  vehicle?: {
    year: number;
    make: string;
    model: string;
    trim?: string;
    primary_image_url?: string;
  };
}

export interface AuctionStats {
  total_listings: number;
  active_listings: number;
  sold_listings: number;
  total_value: number;
  total_views: number;
  total_bids: number;
  by_platform: Record<string, {
    count: number;
    sold: number;
    value: number;
  }>;
}

export class MyAuctionsService {
  private static async getUserOrgMemberships(userId: string): Promise<Array<{ organization_id: string; role: string; organization_name?: string }>> {
    const { data, error } = await supabase
      .from('organization_contributors')
      .select('organization_id, role, businesses:businesses(business_name)')
      .eq('user_id', userId)
      .eq('status', 'active');

    if (error) {
      // Fallback: try without join (some schemas might not have the FK name wired)
      const { data: fallbackData } = await supabase
        .from('organization_contributors')
        .select('organization_id, role')
        .eq('user_id', userId)
        .eq('status', 'active');
      return (fallbackData || []).map((row: any) => ({
        organization_id: row.organization_id,
        role: row.role,
      }));
    }

    return (data || []).map((row: any) => ({
      organization_id: row.organization_id,
      role: row.role,
      organization_name: row.businesses?.business_name,
    }));
  }

  /**
   * Get all listings for current user from all sources
   */
  static async getMyListings(filters?: {
    status?: string;
    platform?: string;
    vehicle_id?: string;
    sortBy?: string;
  }): Promise<UnifiedListing[]> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      const listings: UnifiedListing[] = [];
      const orgMemberships = await this.getUserOrgMemberships(user.id);
      const orgRoleById = new Map(orgMemberships.map(m => [m.organization_id, m.role]));
      const orgNameById = new Map(orgMemberships.map(m => [m.organization_id, m.organization_name].filter(Boolean) as [string, string]));

      // 1. Native n-zero listings
      const { data: nativeListings, error: nativeError } = await supabase
        .from('vehicle_listings')
        .select(`
          id,
          vehicle_id,
          seller_id,
          status,
          current_high_bid_cents,
          reserve_price_cents,
          bid_count,
          auction_end_time,
          created_at,
          updated_at,
          vehicles!inner(
            year,
            make,
            model,
            trim,
            primary_image_url
          )
        `)
        .eq('seller_id', user.id)
        .in('status', ['active', 'ended', 'sold']);

      if (!nativeError && nativeListings) {
        for (const listing of nativeListings) {
          listings.push({
            listing_source: 'native',
            listing_id: listing.id,
            vehicle_id: listing.vehicle_id,
            user_id: listing.seller_id,
            platform: 'nzero',
            listing_status: listing.status,
            scope: 'personal',
            current_bid: listing.current_high_bid_cents ? listing.current_high_bid_cents / 100 : undefined,
            reserve_price: listing.reserve_price_cents ? listing.reserve_price_cents / 100 : undefined,
            bid_count: listing.bid_count || 0,
            end_date: listing.auction_end_time,
            listed_at: listing.created_at,
            last_updated: listing.updated_at,
            vehicle: listing.vehicles ? {
              year: listing.vehicles.year,
              make: listing.vehicles.make,
              model: listing.vehicles.model,
              trim: listing.vehicles.trim,
              primary_image_url: listing.vehicles.primary_image_url,
            } : undefined,
          });
        }
      }

      // 2. External listings (from external_listings table)
      // IMPORTANT: Do not infer "personal profit" just because user is affiliated with an org.
      // We split external listings into:
      // - personal: listings tied to vehicles the user owns in-app
      // - organization: listings tied to orgs the user is an active contributor in (board/admin/etc.)
      const { data: userVehicles, error: userVehiclesError } = await supabase
        .from('vehicles')
        .select('id')
        .eq('user_id', user.id);

      const userVehicleIds = new Set((userVehiclesError ? [] : (userVehicles || [])).map((v: any) => v.id));

      const externalSelect = `
        id,
        vehicle_id,
        organization_id,
        platform,
        listing_status,
        current_bid,
        reserve_price,
        bid_count,
        view_count,
        watcher_count,
        end_date,
        sold_at,
        final_price,
        listing_url,
        metadata,
        created_at,
        updated_at,
        vehicles!inner(
          year,
          make,
          model,
          trim,
          primary_image_url
        )
      `;

      // 2a) Personal external listings (vehicle belongs to user)
      if (userVehicleIds.size > 0) {
        const { data: personalExternal, error: personalExternalError } = await supabase
          .from('external_listings')
          .select(externalSelect)
          .in('vehicle_id', Array.from(userVehicleIds))
          .in('listing_status', ['active', 'ended', 'sold']);

        if (!personalExternalError && personalExternal) {
          for (const listing of personalExternal as any[]) {
            listings.push({
              listing_source: 'external',
              listing_id: listing.id,
              vehicle_id: listing.vehicle_id,
              user_id: user.id,
              platform: listing.platform,
              listing_status: listing.listing_status,
              scope: 'personal',
              organization_id: listing.organization_id || undefined,
              organization_name: listing.organization_id ? orgNameById.get(listing.organization_id) : undefined,
              access_role: listing.organization_id ? orgRoleById.get(listing.organization_id) : undefined,
              metadata: listing.metadata || {},
              current_bid: listing.current_bid ? Number(listing.current_bid) : undefined,
              reserve_price: listing.reserve_price ? Number(listing.reserve_price) : undefined,
              bid_count: listing.bid_count || 0,
              view_count: listing.view_count || 0,
              watcher_count: listing.watcher_count || 0,
              end_date: listing.end_date,
              sold_at: listing.sold_at,
              final_price: listing.final_price ? Number(listing.final_price) : undefined,
              external_url: listing.listing_url,
              listed_at: listing.created_at,
              last_updated: listing.updated_at,
              vehicle: listing.vehicles ? {
                year: listing.vehicles.year,
                make: listing.vehicles.make,
                model: listing.vehicles.model,
                trim: listing.vehicles.trim,
                primary_image_url: listing.vehicles.primary_image_url,
              } : undefined,
            });
          }
        }
      }

      // 2b) Organization external listings (org membership grants access)
      const orgIds = orgMemberships.map(m => m.organization_id).filter(Boolean);
      if (orgIds.length > 0) {
        const { data: orgExternal, error: orgExternalError } = await supabase
          .from('external_listings')
          .select(externalSelect)
          .in('organization_id', orgIds)
          .in('listing_status', ['active', 'ended', 'sold']);

        if (!orgExternalError && orgExternal) {
          for (const listing of orgExternal as any[]) {
            // Avoid duplicates if the same listing is already included via personal vehicle ownership
            const alreadyIncluded = listings.some(l => l.listing_source === 'external' && l.listing_id === listing.id);
            if (alreadyIncluded) continue;

            listings.push({
              listing_source: 'external',
              listing_id: listing.id,
              vehicle_id: listing.vehicle_id,
              user_id: user.id,
              platform: listing.platform,
              listing_status: listing.listing_status,
              scope: 'organization',
              organization_id: listing.organization_id || undefined,
              organization_name: listing.organization_id ? orgNameById.get(listing.organization_id) : undefined,
              access_role: listing.organization_id ? orgRoleById.get(listing.organization_id) : undefined,
              metadata: listing.metadata || {},
              current_bid: listing.current_bid ? Number(listing.current_bid) : undefined,
              reserve_price: listing.reserve_price ? Number(listing.reserve_price) : undefined,
              bid_count: listing.bid_count || 0,
              view_count: listing.view_count || 0,
              watcher_count: listing.watcher_count || 0,
              end_date: listing.end_date,
              sold_at: listing.sold_at,
              final_price: listing.final_price ? Number(listing.final_price) : undefined,
              external_url: listing.listing_url,
              listed_at: listing.created_at,
              last_updated: listing.updated_at,
              vehicle: listing.vehicles ? {
                year: listing.vehicles.year,
                make: listing.vehicles.make,
                model: listing.vehicles.model,
                trim: listing.vehicles.trim,
                primary_image_url: listing.vehicles.primary_image_url,
              } : undefined,
            });
          }
        }
      }

      // 2c) Best-effort enrichment for auction participants + corrected metrics
      // Use the platform-agnostic `auction_events` table (supports BaT, Cars & Bids, etc.)
      try {
        const externalVehicleIds = Array.from(
          new Set(
            listings
              .filter((l) => l.listing_source === 'external' && typeof l.vehicle_id === 'string' && l.vehicle_id)
              .map((l) => l.vehicle_id)
              .filter(Boolean),
          ),
        );

        if (externalVehicleIds.length > 0) {
          const { data: events, error: eventsError } = await supabase
            .from('auction_events')
            .select('vehicle_id, source, source_url, outcome, high_bid, winning_bid, total_bids, page_views, watchers, comments_count, seller_name, winning_bidder, auction_end_date, auction_start_date, updated_at')
            .in('vehicle_id', externalVehicleIds)
            .order('updated_at', { ascending: false })
            .limit(2000);

          if (!eventsError && events) {
            const bestByVehicleAndSource = new Map<string, any>();
            for (const ev of events as any[]) {
              const key = `${ev.vehicle_id}|${ev.source}`;
              if (!bestByVehicleAndSource.has(key)) bestByVehicleAndSource.set(key, ev);
            }

            for (const l of listings) {
              if (l.listing_source !== 'external') continue;
              const key = `${l.vehicle_id}|${l.platform}`;
              const ev = bestByVehicleAndSource.get(key);
              if (!ev) continue;

              // Participants (best-effort)
              l.seller_username = l.seller_username || ev.seller_name || undefined;
              l.buyer_username = l.buyer_username || ev.winning_bidder || undefined;

              // Prefer canonical listing URL
              l.external_url = l.external_url || ev.source_url || undefined;

              // Prefer auction_events metrics when external_listings didn't have them yet
              if ((l.bid_count || 0) === 0 && typeof ev.total_bids === 'number') l.bid_count = ev.total_bids;
              if ((l.view_count || 0) === 0 && typeof ev.page_views === 'number') l.view_count = ev.page_views;
              if ((l.watcher_count || 0) === 0 && typeof ev.watchers === 'number') l.watcher_count = ev.watchers;

              // If sold, prefer winning_bid when missing
              if (!l.final_price && typeof ev.winning_bid === 'number' && ev.winning_bid > 0) {
                l.final_price = Number(ev.winning_bid);
              }
            }
          }
        }
      } catch {
        // non-fatal; some environments may not have auction_events deployed
      }

      // 3. Export listings (from listing_exports table)
      const { data: exportListings, error: exportError } = await supabase
        .from('listing_exports')
        .select(`
          id,
          vehicle_id,
          user_id,
          platform,
          status,
          reserve_price_cents,
          ended_at,
          sold_at,
          sold_price_cents,
          external_listing_url,
          created_at,
          updated_at,
          vehicles!inner(
            year,
            make,
            model,
            trim,
            primary_image_url
          )
        `)
        .eq('user_id', user.id)
        .in('status', ['active', 'sold', 'expired']);

      if (!exportError && exportListings) {
        for (const listing of exportListings) {
          listings.push({
            listing_source: 'export',
            listing_id: listing.id,
            vehicle_id: listing.vehicle_id,
            user_id: listing.user_id,
            platform: listing.platform,
            listing_status: listing.status,
            scope: 'personal',
            reserve_price: listing.reserve_price_cents ? listing.reserve_price_cents / 100 : undefined,
            end_date: listing.ended_at,
            sold_at: listing.sold_at,
            final_price: listing.sold_price_cents ? listing.sold_price_cents / 100 : undefined,
            external_url: listing.external_listing_url,
            listed_at: listing.created_at,
            last_updated: listing.updated_at,
            vehicle: listing.vehicles ? {
              year: listing.vehicles.year,
              make: listing.vehicles.make,
              model: listing.vehicles.model,
              trim: listing.vehicles.trim,
              primary_image_url: listing.vehicles.primary_image_url,
            } : undefined,
          });
        }
      }

      // Apply filters
      let filtered = listings;
      if (filters?.status) {
        filtered = filtered.filter(l => {
          if (filters.status === 'active') return l.listing_status === 'active';
          if (filters.status === 'sold') return l.listing_status === 'sold' || l.listing_status === 'ended';
          if (filters.status === 'expired') return l.listing_status === 'expired' || (l.listing_status === 'ended' && !l.sold_at);
          return true;
        });
      }
      if (filters?.platform) {
        filtered = filtered.filter(l => l.platform === filters.platform);
      }
      if (filters?.vehicle_id) {
        filtered = filtered.filter(l => l.vehicle_id === filters.vehicle_id);
      }

      // Apply sorting
      if (filters?.sortBy) {
        switch (filters.sortBy) {
          case 'ending_soon':
            filtered.sort((a, b) => {
              if (!a.end_date) return 1;
              if (!b.end_date) return -1;
              return new Date(a.end_date).getTime() - new Date(b.end_date).getTime();
            });
            break;
          case 'newest':
            filtered.sort((a, b) => new Date(b.listed_at).getTime() - new Date(a.listed_at).getTime());
            break;
          case 'highest_bid':
            filtered.sort((a, b) => (b.current_bid || 0) - (a.current_bid || 0));
            break;
          case 'most_views':
            filtered.sort((a, b) => (b.view_count || 0) - (a.view_count || 0));
            break;
          case 'most_bids':
            filtered.sort((a, b) => (b.bid_count || 0) - (a.bid_count || 0));
            break;
        }
      }

      return filtered;
    } catch (error) {
      console.error('Error loading my listings:', error);
      return [];
    }
  }

  /**
   * Get listing details
   */
  static async getListingDetails(
    listingId: string,
    listingSource: 'native' | 'external' | 'export'
  ): Promise<UnifiedListing | null> {
    try {
      const listings = await this.getMyListings();
      return listings.find(l => l.listing_id === listingId && l.listing_source === listingSource) || null;
    } catch (error) {
      console.error('Error loading listing details:', error);
      return null;
    }
  }

  /**
   * Sync a specific listing
   */
  static async syncListing(
    listingId: string,
    listingSource: 'native' | 'external' | 'export',
    platform: string
  ): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      // For BaT, call the sync edge function
      if (platform === 'bat' && listingSource === 'external') {
        const { data, error } = await supabase.functions.invoke('sync-bat-listing', {
          body: { externalListingId: listingId },
        });

        if (error) throw error;
        return { success: true, data };
      }

      // For other platforms, just update the sync log
      const { error } = await supabase
        .from('listing_sync_log')
        .insert({
          listing_id: listingId,
          listing_type: listingSource,
          platform,
          sync_status: 'success',
          sync_method: 'manual',
          synced_at: new Date().toISOString(),
        });

      if (error) throw error;
      return { success: true };
    } catch (error) {
      console.error('Error syncing listing:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to sync listing',
      };
    }
  }

  /**
   * Sync all listings for user
   */
  static async syncAllListings(): Promise<{ success: boolean; synced: number; failed: number }> {
    try {
      const listings = await this.getMyListings({ status: 'active' });
      let synced = 0;
      let failed = 0;

      for (const listing of listings) {
        if (listing.platform === 'bat' && listing.listing_source === 'external') {
          const result = await this.syncListing(listing.listing_id, listing.listing_source, listing.platform);
          if (result.success) {
            synced++;
          } else {
            failed++;
          }
        } else {
          synced++; // Count as synced if no sync needed
        }
      }

      return { success: true, synced, failed };
    } catch (error) {
      console.error('Error syncing all listings:', error);
      return { success: false, synced: 0, failed: 0 };
    }
  }

  /**
   * Get auction stats
   */
  static async getAuctionStats(): Promise<AuctionStats> {
    try {
      const listings = await this.getMyListings();

      const activeListings = listings.filter(l => l.listing_status === 'active');
      const soldListings = listings.filter(l => l.listing_status === 'sold' || (l.listing_status === 'ended' && l.sold_at));

      const byPlatform: Record<string, { count: number; sold: number; value: number }> = {};

      for (const listing of listings) {
        if (!byPlatform[listing.platform]) {
          byPlatform[listing.platform] = { count: 0, sold: 0, value: 0 };
        }
        byPlatform[listing.platform].count++;
        if (listing.listing_status === 'sold' || (listing.listing_status === 'ended' && listing.sold_at)) {
          byPlatform[listing.platform].sold++;
          byPlatform[listing.platform].value += listing.final_price || 0;
        }
      }

      const totalValue = soldListings.reduce((sum, l) => sum + (l.final_price || 0), 0);
      const totalViews = listings.reduce((sum, l) => sum + (l.view_count || 0), 0);
      const totalBids = listings.reduce((sum, l) => sum + (l.bid_count || 0), 0);

      return {
        total_listings: listings.length,
        active_listings: activeListings.length,
        sold_listings: soldListings.length,
        total_value: totalValue,
        total_views: totalViews,
        total_bids: totalBids,
        by_platform: byPlatform,
      };
    } catch (error) {
      console.error('Error loading auction stats:', error);
      return {
        total_listings: 0,
        active_listings: 0,
        sold_listings: 0,
        total_value: 0,
        total_views: 0,
        total_bids: 0,
        by_platform: {},
      };
    }
  }

  /**
   * Add manual listing entry
   */
  static async addManualListing(params: {
    vehicle_id: string;
    platform: string;
    listing_url: string;
    listing_id?: string;
  }): Promise<{ success: boolean; listing_id?: string; error?: string }> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        return { success: false, error: 'Not authenticated' };
      }

      // Get organization_id from vehicle (if exists)
      const { data: vehicle } = await supabase
        .from('vehicles')
        .select('origin_organization_id')
        .eq('id', params.vehicle_id)
        .single();

      const organizationId = vehicle?.origin_organization_id;

      if (!organizationId) {
        return { success: false, error: 'Vehicle must be associated with an organization' };
      }

      const { data, error } = await supabase
        .from('external_listings')
        .insert({
          vehicle_id: params.vehicle_id,
          organization_id: organizationId,
          platform: params.platform,
          listing_url: params.listing_url,
          listing_id: params.listing_id,
          listing_status: 'active',
        })
        .select()
        .single();

      if (error) throw error;

      return { success: true, listing_id: data.id };
    } catch (error) {
      console.error('Error adding manual listing:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to add listing',
      };
    }
  }

  /**
   * Update listing status
   */
  static async updateListingStatus(
    listingId: string,
    listingSource: 'native' | 'external' | 'export',
    status: string,
    updates?: any
  ): Promise<{ success: boolean; error?: string }> {
    try {
      let tableName: string;
      if (listingSource === 'native') {
        tableName = 'vehicle_listings';
      } else if (listingSource === 'external') {
        tableName = 'external_listings';
      } else {
        tableName = 'listing_exports';
      }

      const updateData: any = { ...updates };
      if (listingSource === 'external') {
        updateData.listing_status = status;
      } else if (listingSource === 'export') {
        updateData.status = status;
      } else {
        updateData.status = status;
      }

      const { error } = await supabase
        .from(tableName)
        .update(updateData)
        .eq('id', listingId);

      if (error) throw error;

      return { success: true };
    } catch (error) {
      console.error('Error updating listing status:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update listing',
      };
    }
  }
}



