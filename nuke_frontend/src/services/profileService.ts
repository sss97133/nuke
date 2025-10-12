// Profile Service - Comprehensive profile data management
import { supabase } from '../lib/supabase';
import type { Profile, ProfileCompletion, ProfileAchievement, ProfileActivity, ProfileStats, UserContribution, ProfileData, ProfileEditForm } from '../types/profile';

export class ProfileService {
  
  // Get comprehensive profile data
  static async getProfileData(userId: string): Promise<ProfileData | null> {
    try {
      // Get profile first
      const profileResult = await supabase.from('profiles').select('*').eq('id', userId).single();
      
      if (profileResult.error && profileResult.error.code !== 'PGRST116') {
        throw profileResult.error;
      }

      if (!profileResult.data) {
        return null;
      }

      // Force cache bypass - timestamp: ${Date.now()}
      console.log('ProfileService: Loading REAL data (cache bypass active)');
      const [
        completionResult,
        achievementsResult,
        activityResult,
        statsResult,
        vehicleTimelineResult,
        vehicleImagesResult,
        verificationsResult
      ] = await Promise.all([
        supabase.from('profile_completion').select('*').eq('user_id', userId).single(),
        supabase.from('profile_achievements').select('*').eq('user_id', userId).order('earned_at', { ascending: false }),
        supabase.from('profile_activity').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(10),
        supabase.from('profile_stats').select('*').eq('user_id', userId).single(),
        // Get real contribution data from timeline events with full metadata
        supabase.from('timeline_events').select('event_date, event_type, vehicle_id, user_id, metadata, cost_amount, title, description, created_at').eq('user_id', userId),
        // Get image uploads (include EXIF and vehicle_id for proper grouping) 
        supabase.from('vehicle_images').select('created_at, exif_data, user_id, vehicle_id').eq('user_id', userId),
        // Get verifications (no date limit to get full history)
        supabase.from('user_verifications').select('created_at, status').eq('user_id', userId)
      ]);

      // Debug: Log query results
      console.log('ProfileService: Query results:');
      console.log('- Profile:', profileResult.data ? 'found' : 'not found');
      console.log('- Timeline events:', vehicleTimelineResult.data?.length || 0, vehicleTimelineResult.error ? `(ERROR: ${vehicleTimelineResult.error.message})` : '');
      console.log('- Vehicle images:', vehicleImagesResult.data?.length || 0, vehicleImagesResult.error ? `(ERROR: ${vehicleImagesResult.error.message})` : '');
      console.log('- Verifications:', verificationsResult.data?.length || 0, verificationsResult.error ? `(ERROR: ${verificationsResult.error.message})` : '');

      // Helper: normalize any date-ish value to YYYY-MM-DD without timezone shifting
      const toDateOnly = (raw: any): string => {
        if (!raw) return new Date().toISOString().split('T')[0];
        try {
          const s = String(raw);
          if (s.includes('T')) return s.split('T')[0];
          if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
          const d = new Date(s);
          if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
        } catch {}
        return new Date().toISOString().split('T')[0];
      };

      // Build contribution data from real events, per-day per-type (vehicle_data | image_upload | verification)
      const contributionMap = new Map<string, UserContribution>();
      const keyFor = (date: string, type: UserContribution['contribution_type']) => `${date}|${type}`;
      const bump = (date: string, type: UserContribution['contribution_type'], init: Partial<UserContribution>) => {
        const k = keyFor(date, type);
        const ex = contributionMap.get(k) || ({
          id: `${userId}-${date}-${type}`,
          user_id: userId,
          contribution_date: date,
          contribution_type: type,
          contribution_count: 0,
          metadata: {},
          related_vehicle_id: null,
          created_at: new Date().toISOString(),
          ...init,
        } as UserContribution);
        ex.contribution_count += 1;
        contributionMap.set(k, ex);
      };
      
      console.log('ProfileService: Building contributions from real events...');
      console.log('ProfileService: vehicleTimelineResult.data length:', vehicleTimelineResult.data?.length || 0);
      console.log('ProfileService: vehicleImagesResult.data length:', vehicleImagesResult.data?.length || 0);
      console.log('ProfileService: Raw timeline data sample:', vehicleTimelineResult.data?.slice(0, 2));
      console.log('ProfileService: Raw image data sample:', vehicleImagesResult.data?.slice(0, 2));
      
      // Process vehicle timeline events (event_date = when it happened)
      if (vehicleTimelineResult.data) {
        vehicleTimelineResult.data.forEach((event: any) => {
          const raw = event.event_date || event.created_at;
          if (!raw) return;
          const date = toDateOnly(raw);
          bump(date, 'vehicle_data', {
            metadata: { 
              event_type: event.event_type,
              title: event.title,
              description: event.description,
              cost_amount: event.cost_amount,
              duration_minutes: event.metadata?.duration_minutes,
              photo_count: event.metadata?.photo_count
            },
            related_vehicle_id: event.vehicle_id || null,
            created_at: raw,
          });
        });
      }
      
      // Process image uploads (prefer EXIF capture date, normalized to date-only)
      // Group by vehicle_id AND date so each vehicle gets separate contributions
      if (vehicleImagesResult.data) {
        console.log(`ProfileService: Processing ${vehicleImagesResult.data.length} images into contributions`);
        const dateVehicleCounts = new Map<string, number>();
        
        // Group by date+vehicle to create separate contribution entries per vehicle
        const groupedByDateVehicle = new Map<string, Array<any>>();
        
        vehicleImagesResult.data.forEach((img: any) => {
          const takenRaw = (img?.exif_data?.dateTaken || img?.exif_data?.date_taken || img?.exif_data?.DateTimeOriginal || img?.created_at);
          const date = toDateOnly(takenRaw);
          const key = `${date}|${img.vehicle_id || 'unknown'}`;
          
          if (!groupedByDateVehicle.has(key)) {
            groupedByDateVehicle.set(key, []);
          }
          groupedByDateVehicle.get(key)!.push(img);
        });
        
        // Create separate contribution for each date+vehicle combination
        groupedByDateVehicle.forEach((images, key) => {
          const firstImg = images[0];
          const date = key.split('|')[0];
          const vehicleId = firstImg.vehicle_id;
          const takenRaw = (firstImg?.exif_data?.dateTaken || firstImg?.exif_data?.date_taken || firstImg?.exif_data?.DateTimeOriginal || firstImg?.created_at);
          
          // Create one bump per image in this group so count is accurate
          images.forEach(() => {
            bump(date, 'image_upload', { 
              created_at: takenRaw,
              related_vehicle_id: vehicleId
            });
          });
          
          dateVehicleCounts.set(key, images.length);
        });
        
        console.log('ProfileService: Image uploads by date+vehicle:', Array.from(dateVehicleCounts.entries()).sort().slice(-5));
      }
      
      // Process verifications
      if (verificationsResult.data) {
        verificationsResult.data.forEach((ver: any) => {
          const date = toDateOnly(ver.created_at);
          bump(date, 'verification', { created_at: ver.created_at });
        });
      }
      
      const realContributions = Array.from(contributionMap.values());

      console.log('ProfileService: Contribution map size:', contributionMap.size);
      console.log('ProfileService: Built contributions sample:', realContributions.slice(0, 3));
      console.log('ProfileService: Contribution dates:', realContributions.map(c => c.contribution_date).slice(0, 10));

      // ALWAYS use the real contribution data from timeline events, NEVER the fake user_contributions table
      // The user_contributions table has inaccurate/fake data that should be ignored
      const finalContributions = realContributions;
      
      console.log('ProfileService: Using REAL timeline-built contributions data');
      console.log('ProfileService: Real contributions from timeline events:', realContributions.length);
      console.log('ProfileService: Real image uploads:', vehicleImagesResult.data?.length || 0);
      console.log('ProfileService: Final contributions used:', finalContributions.length);
      console.log('ProfileService: Total contribution count:', finalContributions.reduce((sum, c) => sum + c.contribution_count, 0));

      return {
        profile: profileResult.data,
        completion: completionResult.data || null,
        achievements: achievementsResult.data || [],
        recentActivity: activityResult.data || [],
        stats: statsResult.data || null,
        recentContributions: finalContributions, // Prioritize timeline-built data over table data
        certifications: [],
        skills: [],
        experience: [],
        skillProgression: []
      };
    } catch (error) {
      console.error('Error fetching profile data:', error);
      throw error;
    }
  }

  // Update profile information
  static async updateProfile(userId: string, profileData: Partial<ProfileEditForm>): Promise<Profile> {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .upsert({
          id: userId,
          ...profileData,
          updated_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error updating profile:', error);
      throw error;
    }
  }

  // Get profile completion status
  static async getProfileCompletion(userId: string): Promise<ProfileCompletion | null> {
    try {
      const { data, error } = await supabase
        .from('profile_completion')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (error && error.code !== 'PGRST116') {
        throw error;
      }

      return data;
    } catch (error) {
      console.error('Error fetching profile completion:', error);
      throw error;
    }
  }

  // Calculate completion percentage
  static async calculateCompletionPercentage(userId: string): Promise<number> {
    try {
      const { data, error } = await supabase
        .rpc('calculate_profile_completion', { user_uuid: userId });

      if (error) throw error;
      return data || 0;
    } catch (error) {
      console.error('Error calculating completion percentage:', error);
      return 0;
    }
  }

  // Get user achievements
  static async getUserAchievements(userId: string): Promise<ProfileAchievement[]> {
    try {
      const { data, error } = await supabase
        .from('profile_achievements')
        .select('*')
        .eq('user_id', userId)
        .order('earned_at', { ascending: false });

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error fetching achievements:', error);
      return [];
    }
  }

  // Get user activity feed
  static async getUserActivity(userId: string, limit: number = 20): Promise<ProfileActivity[]> {
    try {
      const { data, error } = await supabase
        .from('profile_activity')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error fetching user activity:', error);
      return [];
    }
  }

  // Get user statistics
  static async getUserStats(userId: string): Promise<ProfileStats | null> {
    try {
      const { data, error } = await supabase
        .from('profile_stats')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (error && error.code !== 'PGRST116') {
        throw error;
      }

      return data;
    } catch (error) {
      console.error('Error fetching user stats:', error);
      return null;
    }
  }

  // Get user contributions for heatmap
  static async getUserContributions(userId: string, days: number = 365): Promise<UserContribution[]> {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const { data, error } = await supabase
        .from('user_contributions')
        .select('*')
        .eq('user_id', userId)
        .gte('contribution_date', startDate.toISOString().split('T')[0])
        .order('contribution_date', { ascending: false });

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error fetching user contributions:', error);
      return [];
    }
  }

  // Award achievement (called by system)
  static async awardAchievement(
    userId: string, 
    achievementType: string, 
    title?: string, 
    description?: string, 
    points?: number
  ): Promise<boolean> {
    try {
      const { data, error } = await supabase
        .rpc('award_achievement', {
          user_uuid: userId,
          achievement_type_param: achievementType,
          achievement_title_param: title,
          achievement_description_param: description,
          points_param: points
        });

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error awarding achievement:', error);
      return false;
    }
  }

  // Log contribution (called by system)
  static async logContribution(
    userId: string,
    contributionType: string,
    vehicleId?: string,
    metadata?: Record<string, any>
  ): Promise<boolean> {
    try {
      const { data, error } = await supabase
        .rpc('log_contribution', {
          user_uuid: userId,
          contribution_type_param: contributionType,
          related_vehicle_uuid: vehicleId,
          contribution_metadata: metadata || {}
        });

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error logging contribution:', error);
      return false;
    }
  }

  // Check username availability
  static async checkUsernameAvailability(username: string, currentUserId?: string): Promise<boolean> {
    try {
      let query = supabase
        .from('profiles')
        .select('id')
        .eq('username', username);

      if (currentUserId) {
        query = query.neq('id', currentUserId);
      }

      const { data, error } = await query;

      if (error) throw error;
      return !data || data.length === 0;
    } catch (error) {
      console.error('Error checking username availability:', error);
      return false;
    }
  }

  // Upload avatar
  static async uploadAvatar(userId: string, file: File): Promise<string> {
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}.${fileExt}`;
      const filePath = `avatars/${userId}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('vehicle-data')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data } = supabase.storage
        .from('vehicle-data')
        .getPublicUrl(filePath);

      // Update profile with new avatar URL
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ avatar_url: data.publicUrl })
        .eq('id', userId);
      
      if (updateError) throw updateError;

      return data.publicUrl;
    } catch (error) {
      console.error('Error uploading avatar:', error);
      throw error;
    }
  }

  // Get public profile (for viewing other users)
  static async getPublicProfile(userId: string): Promise<ProfileData | null> {
    try {
      // Only get data for public profiles
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .eq('is_public', true)
        .single();

      if (profileError) {
        if (profileError.code === 'PGRST116') return null;
        throw profileError;
      }

      // Get public data
      const [achievementsResult, activityResult, statsResult] = await Promise.all([
        supabase.from('profile_achievements').select('*').eq('user_id', userId).order('earned_at', { ascending: false }),
        supabase.from('profile_activity').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(10),
        supabase.from('profile_stats').select('*').eq('user_id', userId).single()
      ]);

      return {
        profile,
        completion: null, // Private data
        achievements: achievementsResult.data || [],
        recentActivity: activityResult.data || [],
        stats: statsResult.data || null,
        recentContributions: [], // Private data
        certifications: [],
        skills: [],
        experience: [],
        skillProgression: []
      };
    } catch (error) {
      console.error('Error fetching public profile:', error);
      throw error;
    }
  }
}
