import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import toast from 'react-hot-toast';

export interface FollowROI {
  hypothetical_roi_pct: number | null;
  hypothetical_gain: number | null;
  days_following: number;
  current_price: number | null;
  price_at_follow: number | null;
  has_invested: boolean;
  invested_at: string | null;
  actual_roi_pct: number | null;
}

export interface UseVehicleFollowResult {
  isFollowing: boolean;
  isLoading: boolean;
  followROI: FollowROI | null;
  toggleFollow: () => Promise<void>;
  refreshROI: () => Promise<void>;
}

/**
 * Hook for following vehicles and tracking hypothetical ROI
 * 
 * Following = Pre-investment tracking. Shows "if you invested when you started following,
 * you would have X% return" to create FOMO and drive investment conversion.
 */
export function useVehicleFollow(vehicleId: string): UseVehicleFollowResult {
  const { user } = useAuth();
  const [isFollowing, setIsFollowing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [followROI, setFollowROI] = useState<FollowROI | null>(null);
  const [subscriptionId, setSubscriptionId] = useState<string | null>(null);

  // Check follow status and load ROI
  useEffect(() => {
    if (!user?.id) {
      setIsLoading(false);
      return;
    }
    checkFollowStatus();
  }, [vehicleId, user?.id]);

  const checkFollowStatus = async () => {
    if (!user?.id) return;

    try {
      // Check if user is following
      const { data: subscription, error } = await supabase
        .from('user_subscriptions')
        .select('id, followed_at, price_at_follow, invested_at, investment_amount')
        .eq('user_id', user.id)
        .eq('subscription_type', 'vehicle_status_change')
        .eq('target_id', vehicleId)
        .eq('is_active', true)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        console.error('Error checking follow status:', error);
        setIsLoading(false);
        return;
      }

      if (subscription) {
        setIsFollowing(true);
        setSubscriptionId(subscription.id);
        await loadROI(subscription.id);
      } else {
        setIsFollowing(false);
        setFollowROI(null);
      }
    } catch (error) {
      console.error('Error checking follow status:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadROI = async (subId: string) => {
    try {
      // Get ROI tracking data
      const { data: tracking, error: trackingError } = await supabase
        .from('follow_roi_tracking')
        .select('*')
        .eq('subscription_id', subId)
        .maybeSingle();

      if (trackingError && trackingError.code !== 'PGRST116') {
        console.error('Error loading ROI:', trackingError);
        return;
      }

      if (tracking) {
        setFollowROI({
          hypothetical_roi_pct: tracking.hypothetical_roi_pct,
          hypothetical_gain: tracking.hypothetical_gain,
          days_following: tracking.days_following || 0,
          current_price: tracking.current_price,
          price_at_follow: tracking.price_at_follow,
          has_invested: tracking.has_invested || false,
          invested_at: tracking.invested_at,
          actual_roi_pct: tracking.actual_roi_pct,
        });
      } else {
        // Trigger ROI calculation if tracking doesn't exist
        await refreshROI();
      }
    } catch (error) {
      console.error('Error loading ROI:', error);
    }
  };

  const refreshROI = useCallback(async () => {
    if (!subscriptionId) return;

    try {
      // Call function to update ROI tracking
      const { error } = await supabase.rpc('update_follow_roi_tracking', {
        p_subscription_id: subscriptionId,
      });

      if (error) {
        console.error('Error refreshing ROI:', error);
        return;
      }

      // Reload ROI data
      await loadROI(subscriptionId);
    } catch (error) {
      console.error('Error refreshing ROI:', error);
    }
  }, [subscriptionId]);

  const toggleFollow = async () => {
    if (!user) {
      toast.error('Please sign in to follow vehicles');
      return;
    }

    setIsLoading(true);
    try {
      if (isFollowing && subscriptionId) {
        // Unfollow
        const { error } = await supabase
          .from('user_subscriptions')
          .delete()
          .eq('id', subscriptionId);

        if (error && error.code !== 'PGRST116') {
          throw error;
        }

        setIsFollowing(false);
        setFollowROI(null);
        setSubscriptionId(null);
        toast.success('Unfollowed vehicle');
      } else {
        // Follow - get current price first
        const { data: vehicle, error: vehicleError } = await supabase
          .from('vehicles')
          .select('asking_price, current_value, sale_price')
          .eq('id', vehicleId)
          .single();

        if (vehicleError) {
          throw vehicleError;
        }

        // Get current price (priority: sale_price > asking_price > current_value)
        const currentPrice =
          vehicle.sale_price ||
          vehicle.asking_price ||
          vehicle.current_value ||
          null;

        // Create subscription
        const { data: subscription, error: subError } = await supabase
          .from('user_subscriptions')
          .insert({
            user_id: user.id,
            subscription_type: 'vehicle_status_change',
            target_id: vehicleId,
            followed_at: new Date().toISOString(),
            price_at_follow: currentPrice,
            is_active: true,
            filters: {
              auction_updates: true,
              price_changes: true,
              status_changes: true,
            },
          })
          .select('id')
          .single();

        if (subError) throw subError;

        setIsFollowing(true);
        setSubscriptionId(subscription.id);

        // Wait a moment for trigger to create ROI tracking, then load it
        setTimeout(async () => {
          await loadROI(subscription.id);
        }, 500);

        toast.success('Following vehicle - tracking ROI');
      }
    } catch (error: any) {
      console.error('Error toggling follow:', error);
      toast.error(error.message || 'Failed to update follow status');
    } finally {
      setIsLoading(false);
    }
  };

  return {
    isFollowing,
    isLoading,
    followROI,
    toggleFollow,
    refreshROI,
  };
}
