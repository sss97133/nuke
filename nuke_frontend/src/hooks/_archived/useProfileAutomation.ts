// Profile Automation Hook - Handles automated profile data propagation
import { useEffect } from 'react';
import { ProfileService } from '../services/profileService';

interface ProfileAutomationConfig {
  userId: string;
  enableAchievements?: boolean;
  enableContributionTracking?: boolean;
  enableActivityLogging?: boolean;
}

export const useProfileAutomation = (config: ProfileAutomationConfig) => {
  const { userId, enableAchievements = true, enableContributionTracking = true, enableActivityLogging = true } = config;

  // Vehicle addition automation
  const handleVehicleAdded = async (vehicleId: string, vehicleData: any) => {
    try {
      if (enableContributionTracking) {
        await ProfileService.logContribution(userId, 'vehicle_data', vehicleId, {
          action: 'vehicle_added',
          vehicle_make: vehicleData.make,
          vehicle_model: vehicleData.model,
          vehicle_year: vehicleData.year
        });
      }

      if (enableAchievements) {
        // Check for first vehicle achievement
        const stats = await ProfileService.getUserStats(userId);
        if (stats && stats.total_vehicles === 1) {
          await ProfileService.awardAchievement(userId, 'first_vehicle');
        }
        
        // Check for vehicle collector achievement
        if (stats && stats.total_vehicles >= 5) {
          await ProfileService.awardAchievement(userId, 'vehicle_collector');
        }
      }
    } catch (error) {
      console.error('Error in vehicle addition automation:', error);
    }
  };

  // Image upload automation
  const handleImageUploaded = async (vehicleId: string, imageData: any) => {
    try {
      if (enableContributionTracking) {
        await ProfileService.logContribution(userId, 'image_upload', vehicleId, {
          action: 'image_uploaded',
          image_category: imageData.category,
          image_count: 1
        });
      }

      if (enableAchievements) {
        const stats = await ProfileService.getUserStats(userId);
        
        // First image achievement
        if (stats && stats.total_images === 1) {
          await ProfileService.awardAchievement(userId, 'first_image');
        }
        
        // Image enthusiast achievement
        if (stats && stats.total_images >= 25) {
          await ProfileService.awardAchievement(userId, 'image_enthusiast');
        }
      }
    } catch (error) {
      console.error('Error in image upload automation:', error);
    }
  };

  // Timeline event automation
  const handleTimelineEventAdded = async (vehicleId: string, eventData: any) => {
    try {
      if (enableContributionTracking) {
        await ProfileService.logContribution(userId, 'timeline_event', vehicleId, {
          action: 'timeline_event_added',
          event_type: eventData.event_type,
          event_title: eventData.title
        });
      }
    } catch (error) {
      console.error('Error in timeline event automation:', error);
    }
  };

  // Profile completion automation
  const handleProfileUpdated = async (profileData: any) => {
    try {
      if (enableAchievements) {
        const completion = await ProfileService.getProfileCompletion(userId);
        if (completion && completion.total_completion_percentage === 100) {
          await ProfileService.awardAchievement(userId, 'profile_complete');
        }
      }
    } catch (error) {
      console.error('Error in profile update automation:', error);
    }
  };

  // Verification completion automation
  const handleVerificationCompleted = async (verificationType: string) => {
    try {
      if (enableContributionTracking) {
        await ProfileService.logContribution(userId, 'verification', undefined, {
          action: 'verification_completed',
          verification_type: verificationType
        });
      }

      if (enableAchievements) {
        await ProfileService.awardAchievement(userId, 'verified_user');
      }
    } catch (error) {
      console.error('Error in verification automation:', error);
    }
  };

  return {
    handleVehicleAdded,
    handleImageUploaded,
    handleTimelineEventAdded,
    handleProfileUpdated,
    handleVerificationCompleted
  };
};

// Global profile automation service for use across the app
export class ProfileAutomationService {
  private static instance: ProfileAutomationService;
  private automationHandlers: Map<string, any> = new Map();

  static getInstance(): ProfileAutomationService {
    if (!ProfileAutomationService.instance) {
      ProfileAutomationService.instance = new ProfileAutomationService();
    }
    return ProfileAutomationService.instance;
  }

  registerUser(userId: string, config?: Partial<ProfileAutomationConfig>) {
    const fullConfig = {
      userId,
      enableAchievements: true,
      enableContributionTracking: true,
      enableActivityLogging: true,
      ...config
    };
    
    this.automationHandlers.set(userId, fullConfig);
  }

  async triggerVehicleAdded(userId: string, vehicleId: string, vehicleData: any) {
    const config = this.automationHandlers.get(userId);
    if (!config) return;

    try {
      if (config.enableContributionTracking) {
        await ProfileService.logContribution(userId, 'vehicle_data', vehicleId, {
          action: 'vehicle_added',
          vehicle_make: vehicleData.make,
          vehicle_model: vehicleData.model,
          vehicle_year: vehicleData.year
        });
      }

      if (config.enableAchievements) {
        const stats = await ProfileService.getUserStats(userId);
        if (stats?.total_vehicles === 1) {
          await ProfileService.awardAchievement(userId, 'first_vehicle');
        }
        if (stats && stats.total_vehicles >= 5) {
          await ProfileService.awardAchievement(userId, 'vehicle_collector');
        }
      }
    } catch (error) {
      console.error('Profile automation error:', error);
    }
  }

  async triggerImageUploaded(userId: string, vehicleId: string, imageData: any) {
    const config = this.automationHandlers.get(userId);
    if (!config) return;

    try {
      if (config.enableContributionTracking) {
        await ProfileService.logContribution(userId, 'image_upload', vehicleId, {
          action: 'image_uploaded',
          image_category: imageData.category
        });
      }

      if (config.enableAchievements) {
        const stats = await ProfileService.getUserStats(userId);
        if (stats?.total_images === 1) {
          await ProfileService.awardAchievement(userId, 'first_image');
        }
        if (stats && stats.total_images >= 25) {
          await ProfileService.awardAchievement(userId, 'image_enthusiast');
        }
      }
    } catch (error) {
      console.error('Profile automation error:', error);
    }
  }

  async triggerProfileUpdated(userId: string) {
    const config = this.automationHandlers.get(userId);
    if (!config || !config.enableAchievements) return;

    try {
      const completion = await ProfileService.getProfileCompletion(userId);
      if (completion?.total_completion_percentage === 100) {
        await ProfileService.awardAchievement(userId, 'profile_complete');
      }
    } catch (error) {
      console.error('Profile automation error:', error);
    }
  }
}
