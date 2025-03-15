/**
 * useUnclaimedProfileData
 * 
 * A custom hook that integrates unclaimed dealer profiles with the VehicleTimeline component.
 * Connects to the multi-source connector framework to include dealer data in timeline events.
 */

import { useState, useEffect, useCallback } from 'react';
import { TimelineEvent } from './types';
import unclaimedProfileService, { UnclaimedProfile } from '@/services/UnclaimedProfileService';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/useToast';

interface UseUnclaimedProfileDataProps {
  profileId?: string;
}

interface UseUnclaimedProfileDataReturn {
  loading: boolean;
  profile: UnclaimedProfile | null;
  timelineEvents: TimelineEvent[];
  isSubscribed: boolean;
  toggleSubscription: () => Promise<void>;
  refreshData: () => Promise<void>;
  sendNotificationToSubscribers: (listingTitle: string, listingUrl: string) => Promise<number>;
  searchContactInfo: () => Promise<Array<{ method: string; details: string }>>;
}

/**
 * Hook to integrate unclaimed profile data with the timeline
 */
export const useUnclaimedProfileData = ({ 
  profileId 
}: UseUnclaimedProfileDataProps): UseUnclaimedProfileDataReturn => {
  const [loading, setLoading] = useState<boolean>(true);
  const [profile, setProfile] = useState<UnclaimedProfile | null>(null);
  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([]);
  const [isSubscribed, setIsSubscribed] = useState<boolean>(false);
  
  const { user } = useAuth();
  const { toast } = useToast();
  
  /**
   * Load profile and timeline events
   */
  const loadProfileData = useCallback(async () => {
    if (!profileId) {
      setLoading(false);
      return;
    }
    
    setLoading(true);
    
    try {
      // First, ensure profiles are loaded
      await unclaimedProfileService.loadProfiles();
      
      // Get the specific profile
      const profileData = unclaimedProfileService.getProfile(profileId);
      
      if (profileData) {
        setProfile(profileData);
        
        // Get timeline events for this profile
        const events = unclaimedProfileService.getTimelineEvents(profileId);
        setTimelineEvents(events);
        
        // Check if the current user is subscribed
        if (user) {
          const subscribers = await unclaimedProfileService.getSubscribers(profileId);
          const userSubscription = subscribers.find(sub => sub.userId === user.id);
          setIsSubscribed(!!userSubscription);
        }
      }
    } catch (error) {
      console.error('Error loading unclaimed profile data:', error);
      toast({
        title: 'Error',
        description: 'Failed to load dealer profile data',
        status: 'error'
      });
    } finally {
      setLoading(false);
    }
  }, [profileId, user, toast]);
  
  /**
   * Toggle the user's subscription status for this dealer
   */
  const toggleSubscription = useCallback(async () => {
    if (!user || !profileId || !profile) return;
    
    try {
      if (isSubscribed) {
        // Unsubscribe logic would be here
        // For now, we'll just toast a message since we don't have that implemented
        toast({
          title: 'Not yet implemented',
          description: 'Unsubscribing from dealers is not yet implemented',
          status: 'info'
        });
      } else {
        // Subscribe to the dealer
        const success = await unclaimedProfileService.subscribeToDealer(
          user.id,
          profileId,
          true, // Notify on new listings
          false // Don't notify on price changes
        );
        
        if (success) {
          setIsSubscribed(true);
          toast({
            title: 'Subscribed',
            description: `You'll be notified when ${profile.userInfo.displayName} lists new vehicles`,
            status: 'success'
          });
        }
      }
    } catch (error) {
      console.error('Error toggling subscription:', error);
      toast({
        title: 'Error',
        description: 'Failed to update subscription',
        status: 'error'
      });
    }
  }, [user, profileId, profile, isSubscribed, toast]);
  
  /**
   * Manually refresh the data
   */
  const refreshData = useCallback(async () => {
    await loadProfileData();
  }, [loadProfileData]);
  
  /**
   * Send a notification to all subscribers about a new listing
   */
  const sendNotificationToSubscribers = useCallback(async (
    listingTitle: string,
    listingUrl: string
  ): Promise<number> => {
    if (!profileId || !profile) return 0;
    
    try {
      const result = await unclaimedProfileService.notifySubscribersOfNewListing(
        profileId,
        listingTitle,
        listingUrl
      );
      
      if (result.success) {
        toast({
          title: 'Notification Sent',
          description: `Notified ${result.notifiedCount} subscribers about the new listing`,
          status: 'success'
        });
        return result.notifiedCount;
      }
      
      return 0;
    } catch (error) {
      console.error('Error sending notifications:', error);
      toast({
        title: 'Error',
        description: 'Failed to send notifications',
        status: 'error'
      });
      return 0;
    }
  }, [profileId, profile, toast]);
  
  /**
   * Search for contact information for this dealer
   */
  const searchContactInfo = useCallback(async (): Promise<Array<{ method: string; details: string }>> => {
    if (!profileId) return [];
    
    try {
      const result = await unclaimedProfileService.searchContactInfo(profileId);
      
      if (result.success) {
        return result.contactMethods;
      }
      
      return [];
    } catch (error) {
      console.error('Error searching contact info:', error);
      toast({
        title: 'Error',
        description: 'Failed to search for contact information',
        status: 'error'
      });
      return [];
    }
  }, [profileId, toast]);
  
  // Load the data when the component mounts or when dependencies change
  useEffect(() => {
    loadProfileData();
  }, [loadProfileData]);
  
  return {
    loading,
    profile,
    timelineEvents,
    isSubscribed,
    toggleSubscription,
    refreshData,
    sendNotificationToSubscribers,
    searchContactInfo
  };
};
