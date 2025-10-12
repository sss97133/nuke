import { supabase } from '../lib/supabase';

interface ViewData {
  vehicleId: string;
  userId?: string;
  sessionId?: string;
  userAgent?: string;
  referrer?: string;
  ipAddress?: string;
}

class ViewTrackingService {
  private static readonly VIEW_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes
  private static viewCache = new Set<string>();

  /**
   * Track a vehicle view with duplicate prevention
   */
  static async trackVehicleView(vehicleId: string, userId?: string): Promise<boolean> {
    try {
      // Create a cache key to prevent duplicate views within cooldown period
      const cacheKey = `${vehicleId}-${userId || 'anonymous'}`;

      if (this.viewCache.has(cacheKey)) {
        return false; // Already tracked recently
      }

      // Get session info
      const sessionId = this.getSessionId();
      const userAgent = navigator.userAgent;
      const referrer = document.referrer;

      const viewData: ViewData = {
        vehicleId,
        userId,
        sessionId,
        userAgent,
        referrer
      };

      // Check if this view already exists recently (server-side duplicate prevention)
      const { data: existingViews } = await supabase
        .from('vehicle_views')
        .select('id, created_at')
        .eq('vehicle_id', vehicleId)
        .eq('session_id', sessionId)
        .gte('created_at', new Date(Date.now() - this.VIEW_COOLDOWN_MS).toISOString());

      if (existingViews && existingViews.length > 0) {
        return false; // Recent view exists
      }

      // Track the view
      const { error } = await supabase
        .from('vehicle_views')
        .insert({
          vehicle_id: vehicleId,
          user_id: userId || null,
          session_id: sessionId,
          user_agent: userAgent,
          referrer: referrer || null,
          viewed_at: new Date().toISOString()
        });

      if (error) {
        console.error('Error tracking vehicle view:', error);
        return false;
      }

      // Add to cache and set cleanup timer
      this.viewCache.add(cacheKey);
      setTimeout(() => {
        this.viewCache.delete(cacheKey);
      }, this.VIEW_COOLDOWN_MS);

      // Update vehicle view count (denormalized for performance)
      await this.updateVehicleViewCount(vehicleId);

      return true;
    } catch (error) {
      console.error('Error in trackVehicleView:', error);
      return false;
    }
  }

  /**
   * Get total view count for a vehicle
   */
  static async getVehicleViewCount(vehicleId: string): Promise<number> {
    try {
      const { count } = await supabase
        .from('vehicle_views')
        .select('*', { count: 'exact', head: true })
        .eq('vehicle_id', vehicleId);

      return count || 0;
    } catch (error) {
      console.error('Error getting vehicle view count:', error);
      return 0;
    }
  }

  /**
   * Get unique viewer count for a vehicle (excludes anonymous views)
   */
  static async getUniqueViewerCount(vehicleId: string): Promise<number> {
    try {
      const { data } = await supabase
        .from('vehicle_views')
        .select('user_id')
        .eq('vehicle_id', vehicleId)
        .not('user_id', 'is', null);

      if (!data) return 0;

      const uniqueUsers = new Set(data.map(view => view.user_id));
      return uniqueUsers.size;
    } catch (error) {
      console.error('Error getting unique viewer count:', error);
      return 0;
    }
  }

  /**
   * Get view analytics for a vehicle (for owners)
   */
  static async getVehicleViewAnalytics(vehicleId: string) {
    try {
      const { data: views } = await supabase
        .from('vehicle_views')
        .select('created_at, user_id, referrer')
        .eq('vehicle_id', vehicleId)
        .order('created_at', { ascending: false })
        .limit(100);

      if (!views) return null;

      // Group by day
      const viewsByDay: Record<string, number> = {};
      const referrers: Record<string, number> = {};
      let uniqueViewers = 0;
      const userIds = new Set();

      views.forEach(view => {
        const day = new Date(view.created_at).toISOString().split('T')[0];
        viewsByDay[day] = (viewsByDay[day] || 0) + 1;

        if (view.referrer) {
          const domain = this.extractDomain(view.referrer);
          referrers[domain] = (referrers[domain] || 0) + 1;
        }

        if (view.user_id && !userIds.has(view.user_id)) {
          userIds.add(view.user_id);
          uniqueViewers++;
        }
      });

      return {
        totalViews: views.length,
        uniqueViewers,
        viewsByDay,
        topReferrers: Object.entries(referrers)
          .sort(([,a], [,b]) => b - a)
          .slice(0, 10)
          .map(([domain, count]) => ({ domain, count })),
        recentViews: views.slice(0, 20)
      };
    } catch (error) {
      console.error('Error getting vehicle view analytics:', error);
      return null;
    }
  }

  /**
   * Update denormalized view count on vehicle record
   */
  private static async updateVehicleViewCount(vehicleId: string) {
    try {
      const { count } = await supabase
        .from('vehicle_views')
        .select('*', { count: 'exact', head: true })
        .eq('vehicle_id', vehicleId);

      await supabase
        .from('vehicles')
        .update({ view_count: count || 0 })
        .eq('id', vehicleId);
    } catch (error) {
      console.error('Error updating vehicle view count:', error);
    }
  }

  /**
   * Generate or get session ID
   */
  private static getSessionId(): string {
    let sessionId = sessionStorage.getItem('view_session_id');
    if (!sessionId) {
      sessionId = `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      sessionStorage.setItem('view_session_id', sessionId);
    }
    return sessionId;
  }

  /**
   * Extract domain from referrer URL
   */
  private static extractDomain(url: string): string {
    try {
      return new URL(url).hostname;
    } catch {
      return 'unknown';
    }
  }

  /**
   * Track vehicle save/unsave
   */
  static async toggleVehicleSave(vehicleId: string, userId: string): Promise<boolean> {
    try {
      const { data: existingSave } = await supabase
        .from('user_vehicle_saves')
        .select('id')
        .eq('vehicle_id', vehicleId)
        .eq('user_id', userId)
        .single();

      if (existingSave) {
        // Remove save
        const { error } = await supabase
          .from('user_vehicle_saves')
          .delete()
          .eq('id', existingSave.id);

        if (error) throw error;
        return false; // Not saved anymore
      } else {
        // Add save
        const { error } = await supabase
          .from('user_vehicle_saves')
          .insert({
            vehicle_id: vehicleId,
            user_id: userId,
            saved_at: new Date().toISOString()
          });

        if (error) throw error;
        return true; // Now saved
      }
    } catch (error) {
      console.error('Error toggling vehicle save:', error);
      throw error;
    }
  }

  /**
   * Check if user has saved a vehicle
   */
  static async isVehicleSaved(vehicleId: string, userId: string): Promise<boolean> {
    try {
      const { data } = await supabase
        .from('user_vehicle_saves')
        .select('id')
        .eq('vehicle_id', vehicleId)
        .eq('user_id', userId)
        .single();

      return !!data;
    } catch (error) {
      return false;
    }
  }
}

export default ViewTrackingService;