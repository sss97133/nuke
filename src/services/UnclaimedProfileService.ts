/**
 * Unclaimed Profile Service
 * 
 * Manages unclaimed dealer profiles and integrates with the multi-source connector framework.
 * Provides functionality for:
 * - Loading and storing unclaimed dealer profiles
 * - Connecting profile data to the timeline service
 * - Managing notification preferences for users interested in specific dealers
 * - Searching for contact information to help dealers claim their profiles
 */

import { supabase } from '@/utils/supabaseClient';
import { TimelineEvent } from '@/components/VehicleTimeline/types';
import { readLocalFile, writeLocalFile } from '@/utils/fileUtil';
import { VehicleSource } from '@/types/vehicle';

interface Listing {
  id: string;
  title: string;
  description: string;
  price: number;
  status: string;
  createdAt: string;
  updatedAt: string;
  userId: string;
  vehicleId: string;
  images: string[];
  metadata: Record<string, unknown>;
}

// Types for unclaimed profile data
export interface UnclaimedProfile {
  profileId: string;
  source: string;
  status: 'unclaimed' | 'claimed' | 'pending';
  createdAt: string;
  userInfo: {
    username: string;
    displayName: string;
    profileUrl: string;
    memberSince: string;
    location: string;
    reputation?: {
      thumbsUp?: number;
      totalComments?: number;
    };
  };
  salesActivity: {
    totalListings: number;
    soldVehicles: number;
    activeListings: number;
    totalSalesValue: number;
    avgPrice: number;
    verifiedListings: number;
    statisticallyModeledListings: number;
    mostRecentListing?: Listing;
  };
  inventory: {
    byMake: Array<{
      make: string;
      count: number;
      percentage: number;
      examples?: string[];
    }>;
    byDecade: Array<{
      decade: string;
      count: number;
      percentage: number;
    }>;
  };
  verifiedListings: Listing[];
  communicationProfile: {
    style: string;
    tone: string;
    formality: string;
    responseTime: string;
    technicalDetail: string;
    sentiment: string;
    communicationSkills: string;
    sellingApproach: string;
    noteworthy: string;
  };
  interactionNetwork: {
    frequentInteractions: Array<{
      username: string;
      count: number;
      role: string;
    }>;
    potentialFollowers: string[];
  };
  contactSuggestions: Array<{
    method: string;
    query?: string;
    details?: string;
    platforms?: string[];
  }>;
  notificationSettings: {
    shouldNotifyFollowers: boolean;
    notificationTemplate: string;
  };
  notes: string;
}

// Types for notification subscriptions
export interface DealerSubscription {
  id: string;
  userId: string;
  dealerProfileId: string;
  source: string;
  notifyOnNewListing: boolean;
  notifyOnPriceChange: boolean;
  createdAt: string;
}

/**
 * Service for managing unclaimed profiles
 */
export class UnclaimedProfileService {
  private static instance: UnclaimedProfileService;
  private profiles: Map<string, UnclaimedProfile> = new Map();
  private subscriptions: Map<string, DealerSubscription[]> = new Map();
  
  private constructor() {
    // Initialize with empty data
  }
  
  /**
   * Get singleton instance
   */
  public static getInstance(): UnclaimedProfileService {
    if (!UnclaimedProfileService.instance) {
      UnclaimedProfileService.instance = new UnclaimedProfileService();
    }
    return UnclaimedProfileService.instance;
  }
  
  /**
   * Load profiles from database or local files
   */
  public async loadProfiles(): Promise<void> {
    try {
      // First try to load from database
      const { data, error } = await supabase
        .from('unclaimed_profiles')
        .select('*');
      
      if (error) {
        console.error('Error loading profiles from database:', error);
        // Fallback to local files
        await this.loadProfilesFromLocalFiles();
      } else if (data && data.length > 0) {
        // Store profiles from database
        data.forEach(profile => {
          this.profiles.set(profile.profileId, profile as UnclaimedProfile);
        });
        console.log(`Loaded ${data.length} profiles from database`);
      } else {
        // No profiles in database, try local files
        await this.loadProfilesFromLocalFiles();
      }
    } catch (error) {
      console.error('Failed to load profiles:', error);
      throw error;
    }
  }
  
  /**
   * Load profiles from local JSON files
   */
  private async loadProfilesFromLocalFiles(): Promise<void> {
    try {
      const vivalasvegasProfile = await readLocalFile(
        'data/bat-analysis/unclaimed_profile_vivalasvegasautos.json'
      );
      
      if (vivalasvegasProfile) {
        const profile = JSON.parse(vivalasvegasProfile) as UnclaimedProfile;
        this.profiles.set(profile.profileId, profile);
        console.log(`Loaded profile for ${profile.userInfo.displayName} from local file`);
      }
    } catch (error) {
      console.error('Error loading profiles from local files:', error);
    }
  }
  
  /**
   * Get an unclaimed profile by ID
   */
  public getProfile(profileId: string): UnclaimedProfile | undefined {
    return this.profiles.get(profileId);
  }
  
  /**
   * Get all unclaimed profiles
   */
  public getAllProfiles(): UnclaimedProfile[] {
    return Array.from(this.profiles.values());
  }
  
  /**
   * Convert profile and listings to timeline events
   */
  public getTimelineEvents(profileId: string): TimelineEvent[] {
    const profile = this.profiles.get(profileId);
    if (!profile) return [];
    
    try {
      // Try to load timeline events from local file
      const eventsJson = readLocalFile(
        `data/bat-analysis/timeline_events_${profile.userInfo.username}.json`
      );
      
      if (eventsJson) {
        return JSON.parse(eventsJson) as TimelineEvent[];
      }
      
      // Fallback to generate events from verified listings
      return profile.verifiedListings
        .filter(listing => listing.status === 'sold')
        .map(listing => ({
          eventType: 'vehicle_sale',
          source: profile.source as VehicleSource,
          date: listing.saleDate || new Date().toISOString().split('T')[0],
          confidence: 0.95,
          metadata: {
            title: listing.title,
            url: listing.url,
            year: listing.year,
            make: listing.make,
            model: listing.model,
            price: listing.soldPrice,
            imageUrl: listing.imageUrl,
            seller: profile.userInfo.displayName,
            sellerUsername: profile.userInfo.username,
            sellerLocation: profile.userInfo.location,
            platform: 'Bring a Trailer'
          }
        }));
    } catch (error) {
      console.error(`Error getting timeline events for ${profileId}:`, error);
      return [];
    }
  }
  
  /**
   * Store a user's subscription to a dealer profile
   */
  public async subscribeToDealer(
    userId: string,
    dealerProfileId: string,
    notifyOnNewListing: boolean = true,
    notifyOnPriceChange: boolean = false
  ): Promise<boolean> {
    try {
      const { data, error } = await supabase
        .from('dealer_subscriptions')
        .insert({
          userId,
          dealerProfileId,
          source: dealerProfileId.split('_')[0],
          notifyOnNewListing,
          notifyOnPriceChange
        })
        .select();
      
      if (error) {
        console.error('Error subscribing to dealer:', error);
        return false;
      }
      
      // Update local cache
      const profile = this.profiles.get(dealerProfileId);
      if (profile && data && data.length > 0) {
        const subs = this.subscriptions.get(dealerProfileId) || [];
        subs.push(data[0] as DealerSubscription);
        this.subscriptions.set(dealerProfileId, subs);
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('Failed to subscribe to dealer:', error);
      return false;
    }
  }
  
  /**
   * Get all users subscribed to a dealer
   */
  public async getSubscribers(dealerProfileId: string): Promise<DealerSubscription[]> {
    try {
      // Try to get from cache first
      if (this.subscriptions.has(dealerProfileId)) {
        return this.subscriptions.get(dealerProfileId) || [];
      }
      
      // Query database
      const { data, error } = await supabase
        .from('dealer_subscriptions')
        .select('*')
        .eq('dealerProfileId', dealerProfileId);
      
      if (error) {
        console.error('Error getting subscribers:', error);
        return [];
      }
      
      // Cache the result
      const subscriptions = data as DealerSubscription[];
      this.subscriptions.set(dealerProfileId, subscriptions);
      
      return subscriptions;
    } catch (error) {
      console.error('Failed to get subscribers:', error);
      return [];
    }
  }
  
  /**
   * Notify subscribers about a new listing
   */
  public async notifySubscribersOfNewListing(
    dealerProfileId: string,
    listingTitle: string,
    listingUrl: string
  ): Promise<{ success: boolean; notifiedCount: number }> {
    try {
      const profile = this.profiles.get(dealerProfileId);
      if (!profile) {
        return { success: false, notifiedCount: 0 };
      }
      
      const subscribers = await this.getSubscribers(dealerProfileId);
      const subscribersToNotify = subscribers.filter(sub => sub.notifyOnNewListing);
      
      if (subscribersToNotify.length === 0) {
        return { success: true, notifiedCount: 0 };
      }
      
      // In a real implementation, you would send notifications here
      // For now, we'll just log them
      console.log(`Notifying ${subscribersToNotify.length} subscribers about new listing from ${profile.userInfo.displayName}`);
      console.log(`Listing: ${listingTitle}`);
      console.log(`URL: ${listingUrl}`);
      
      const notificationTemplate = profile.notificationSettings.notificationTemplate
        .replace('{{listing_title}}', listingTitle)
        .replace('{{listing_url}}', listingUrl);
      
      console.log(`Notification message: ${notificationTemplate}`);
      
      return { success: true, notifiedCount: subscribersToNotify.length };
    } catch (error) {
      console.error('Failed to notify subscribers:', error);
      return { success: false, notifiedCount: 0 };
    }
  }
  
  /**
   * Save a profile to the database
   */
  public async saveProfile(profile: UnclaimedProfile): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('unclaimed_profiles')
        .upsert([profile], { onConflict: 'profileId' });
      
      if (error) {
        console.error('Error saving profile to database:', error);
        
        // Fallback to local file
        await writeLocalFile(
          `data/bat-analysis/unclaimed_profile_${profile.userInfo.username}.json`,
          JSON.stringify(profile, null, 2)
        );
        
        // Update local cache
        this.profiles.set(profile.profileId, profile);
        return true;
      }
      
      // Update local cache
      this.profiles.set(profile.profileId, profile);
      return true;
    } catch (error) {
      console.error('Failed to save profile:', error);
      return false;
    }
  }
  
  /**
   * Update a profile's status (e.g., when claimed)
   */
  public async updateProfileStatus(
    profileId: string, 
    status: 'unclaimed' | 'claimed' | 'pending'
  ): Promise<boolean> {
    try {
      const profile = this.profiles.get(profileId);
      if (!profile) return false;
      
      profile.status = status;
      
      const { error } = await supabase
        .from('unclaimed_profiles')
        .update({ status })
        .eq('profileId', profileId);
      
      if (error) {
        console.error('Error updating profile status:', error);
        return false;
      }
      
      // Update local cache
      this.profiles.set(profileId, profile);
      return true;
    } catch (error) {
      console.error('Failed to update profile status:', error);
      return false;
    }
  }
  
  /**
   * Search for contact information for a profile
   */
  public async searchContactInfo(profileId: string): Promise<{ 
    success: boolean; 
    contactMethods: Array<{ method: string; details: string }> 
  }> {
    const profile = this.profiles.get(profileId);
    if (!profile) {
      return { 
        success: false, 
        contactMethods: [] 
      };
    }
    
    // In a real implementation, this would search external APIs for contact information
    // For now, we'll just return the suggestions from the profile
    return {
      success: true,
      contactMethods: profile.contactSuggestions.map(suggestion => ({
        method: suggestion.method,
        details: suggestion.details || ''
      }))
    };
  }
}

export default UnclaimedProfileService.getInstance();
