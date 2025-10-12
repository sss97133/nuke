import { supabase } from '../lib/supabase';

export interface FeedItem {
  id: string;
  type: 'new_vehicle' | 'timeline_event' | 'new_images' | 'skynalysis_result' | 'vehicle_update' | 'user_activity';
  title: string;
  description: string;
  imageUrl?: string;
  timestamp: string;
  user_id?: string;
  username?: string;
  vehicle_id?: string;
  metadata: Record<string, any>;
  priority: number;
}

export interface FeedFilters {
  limit?: number;
  offset?: number;
  types?: FeedItem['type'][];
  userId?: string;
  vehicleId?: string;
  dateRange?: {
    start: string;
    end: string;
  };
}

export class FeedService {
  // Main feed aggregation method
  static async getFeedItems(filters: FeedFilters = {}): Promise<FeedItem[]> {
    const { limit = 50, offset = 0, types, userId, vehicleId, dateRange } = filters;
    
    try {
      // Use a single query with joins for better performance
      const query = supabase
        .from('feed_items_view') // We'll create this materialized view
        .select('*')
        .order('timestamp', { ascending: false })
        .range(offset, offset + limit - 1);

      if (types && types.length > 0) {
        query.in('type', types);
      }

      if (userId) {
        query.eq('user_id', userId);
      }

      if (vehicleId) {
        query.eq('vehicle_id', vehicleId);
      }

      if (dateRange) {
        query.gte('timestamp', dateRange.start);
        query.lte('timestamp', dateRange.end);
      }

      const { data, error } = await query;
      
      if (error) {
        console.error('Error fetching feed items:', error);
        // Fallback to legacy method
        return this.getFeedItemsLegacy(filters);
      }

      return data || [];
    } catch (error) {
      console.error('Feed service error:', error);
      // Fallback to legacy method
      return this.getFeedItemsLegacy(filters);
    }
  }

  // Legacy method as fallback (current implementation)
  static async getFeedItemsLegacy(filters: FeedFilters = {}): Promise<FeedItem[]> {
    const { limit = 50 } = filters;
    
    try {
      // Parallel queries for better performance
      const [vehiclesResponse, timelineEventsResponse, vehicleImagesResponse, skynalysisResponse] = await Promise.all([
        this.getVehicleFeedItems(),
        this.getTimelineEventFeedItems(),
        this.getImageFeedItems(),
        this.getSkynalysiseFeedItems()
      ]);

      const allItems = [
        ...vehiclesResponse,
        ...timelineEventsResponse,
        ...vehicleImagesResponse,
        ...skynalysisResponse
      ];

      // Sort by timestamp and apply limit
      allItems.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      
      return allItems.slice(0, limit);
    } catch (error) {
      console.error('Error in legacy feed method:', error);
      return [];
    }
  }

  // Get vehicle-related feed items
  static async getVehicleFeedItems(): Promise<FeedItem[]> {
    try {
      const { data: vehicles, error: vehiclesError } = await supabase
        .from('vehicles')
        .select(`
          *,
          vehicle_images(
            image_url,
            is_primary,
            variants
          )
        `)
        .order('created_at', { ascending: false })
        .limit(50);

      if (vehiclesError) {
        console.error('Error fetching vehicles:', vehiclesError);
        return [];
      }

      return (vehicles || []).map((vehicle: any) => {
        const primaryImage = vehicle.vehicle_images?.find((img: any) => img.is_primary) || vehicle.vehicle_images?.[0];

        // Use medium variant for feed thumbnails, fallback to original
        const imageUrl = primaryImage?.variants?.medium || primaryImage?.variants?.thumbnail || primaryImage?.image_url;

        return {
          id: `vehicle_${vehicle.id}`,
          type: 'new_vehicle' as const,
          title: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
          description: vehicle.description || 'Added to database',
          timestamp: vehicle.created_at,
          user_id: vehicle.user_id,
          username: undefined,
          vehicle_id: vehicle.id,
          metadata: {
            make: vehicle.make,
            model: vehicle.model,
            year: vehicle.year,
            color: vehicle.color,
            mileage: vehicle.mileage,
            vin: vehicle.vin,
            primaryImageUrl: imageUrl,
            isForSale: vehicle.is_for_sale,
            salePrice: vehicle.sale_price
          },
          priority: 1
        };
      });
    } catch (error) {
      console.error('Error in getVehicleFeedItems:', error);
      return [];
    }
  }

  // Get timeline event feed items
  static async getTimelineEventFeedItems(): Promise<FeedItem[]> {
    try {
      const { data: events, error } = await supabase
        .from('timeline_events')
        .select('id, vehicle_id, event_type, event_description, event_date, created_at')
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) {
        console.error('Error fetching timeline events:', error);
        return [];
      }

      return (events || []).map((event: any) => ({
        id: `timeline_${event.id}`,
        type: 'timeline_event' as const,
        title: event.event_type,
        description: event.event_description || 'Timeline event',
        timestamp: event.created_at,
        user_id: undefined,
        username: undefined,
        vehicle_id: event.vehicle_id,
        metadata: {
          eventDate: event.event_date,
          eventType: event.event_type
        },
        priority: 1
      }));
    } catch (error) {
      console.error('Error in getTimelineEventFeedItems:', error);
      return [];
    }
  }

  // Get image upload feed items
  static async getImageFeedItems(): Promise<FeedItem[]> {
    try {
      // Skip images for now - table may not exist
      return [];
    } catch (error) {
      console.error('Error in getImageFeedItems:', error);
      return [];
    }
  }

  // Get Skynalysis feed items
  static async getSkynalysiseFeedItems(): Promise<FeedItem[]> {
    try {
      // Skip skynalysis for now - table may not exist
      return [];
    } catch (error) {
      console.error('Error in getSkynalysiseFeedItems:', error);
      return [];
    }
  }

  // Subscribe to real-time feed updates
  static subscribeToFeedUpdates(callback: (item: FeedItem) => void) {
    const subscriptions = [
      // Subscribe to new vehicles
      supabase
        .channel('vehicles_feed')
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'vehicles',
          filter: 'is_public=eq.true'
        }, async (payload) => {
          const vehicle = payload.new;
          if (vehicle.source !== 'Bring a Trailer' && vehicle.user_id !== '00000000-0000-0000-0000-000000000000') {
            // Fetch user profile for the new vehicle
            const { data: profile } = await supabase
              .from('profiles')
              .select('username, full_name')
              .eq('id', vehicle.user_id)
              .single();

            callback({
              id: `vehicle_${vehicle.id}`,
              type: 'new_vehicle',
              title: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
              description: `Added by ${this.getUserDisplay(profile)}`,
              timestamp: vehicle.created_at,
              user_id: vehicle.user_id,
              username: profile?.username,
              vehicle_id: vehicle.id,
              metadata: {
                salePrice: vehicle.sale_price,
                isForSale: vehicle.is_for_sale,
                make: vehicle.make,
                model: vehicle.model,
                year: vehicle.year
              },
              priority: vehicle.is_for_sale ? 2 : 1
            });
          }
        }),

      // Subscribe to new images
      supabase
        .channel('images_feed')
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'vehicle_images'
        }, async (payload) => {
          const image = payload.new;
          // Fetch vehicle and user info
          const { data: vehicle } = await supabase
            .from('vehicles')
            .select('make, model, year, is_public, user_id, profiles!user_id(username, full_name)')
            .eq('id', image.vehicle_id)
            .eq('is_public', true)
            .single();

          if (vehicle && vehicle.user_id !== '00000000-0000-0000-0000-000000000000') {
            callback({
              id: `image_${image.id}`,
              type: 'new_images',
              title: `New ${image.image_category || 'image'} uploaded`,
              description: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
              imageUrl: image.image_url,
              timestamp: image.uploaded_at,
              user_id: vehicle.user_id,
              username: Array.isArray(vehicle.profiles) ? vehicle.profiles[0]?.username : (vehicle.profiles as any)?.username,
              vehicle_id: image.vehicle_id,
              metadata: {
                imageCategory: image.image_category,
                vehicleName: `${vehicle.year} ${vehicle.make} ${vehicle.model}`
              },
              priority: 1
            });
          }
        })
    ];

    return {
      unsubscribe: () => {
        subscriptions.forEach(sub => sub.unsubscribe());
      }
    };
  }

  // Helper method for user display
  private static getUserDisplay(profile: any): string {
    if (!profile) return 'Anonymous User';
    return profile.username ? `@${profile.username}` : profile.full_name || 'Anonymous User';
  }

  // Get feed stats for analytics
  static async getFeedStats(): Promise<{
    totalItems: number;
    itemsByType: Record<string, number>;
    activeUsers: number;
    recentActivity: number;
  }> {
    try {
      const [vehicleCount, timelineCount, imageCount, analysisCount, userCount] = await Promise.all([
        supabase.from('vehicles').select('id', { count: 'exact' }).eq('is_public', true),
        supabase.from('timeline_events').select('id', { count: 'exact' }),
        supabase.from('vehicle_images').select('id', { count: 'exact' }),
        supabase.from('skynalysis_analyses').select('id', { count: 'exact' }),
        supabase.from('profiles').select('id', { count: 'exact' })
      ]);

      const totalItems = (vehicleCount.count || 0) + (timelineCount.count || 0) + 
                        (imageCount.count || 0) + (analysisCount.count || 0);

      return {
        totalItems,
        itemsByType: {
          vehicles: vehicleCount.count || 0,
          timeline_events: timelineCount.count || 0,
          images: imageCount.count || 0,
          analyses: analysisCount.count || 0
        },
        activeUsers: userCount.count || 0,
        recentActivity: totalItems // Simplified for now
      };
    } catch (error) {
      console.error('Error getting feed stats:', error);
      return {
        totalItems: 0,
        itemsByType: {},
        activeUsers: 0,
        recentActivity: 0
      };
    }
  }
}
