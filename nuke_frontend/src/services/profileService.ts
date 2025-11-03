// Profile Service - Comprehensive profile data management
import { supabase } from '../lib/supabase';
import { AIInsightsService, type ImageInsightResult, type ImageInsightRequest } from './aiInsightsService';
import type {
  Profile,
  ProfileCompletion,
  ProfileAchievement,
  ProfileActivity,
  ProfileStats,
  UserContribution,
  ProfileData,
  ProfileEditForm,
  DailyContributionSummary,
  ContributionHighlight
} from '../types/profile';

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
        verificationsResult,
        orgTimelineResult,
        contractorWorkResult
      ] = await Promise.all([
        supabase.from('profile_completion').select('*').eq('user_id', userId).single(),
        supabase.from('profile_achievements').select('*').eq('user_id', userId).order('earned_at', { ascending: false }).limit(50),
        supabase.from('profile_activity').select('*').eq('user_id', userId).order('created_at', { ascending: false}).limit(10),
        supabase.from('profile_stats').select('*').eq('user_id', userId).single(),
        // Get real contribution data from timeline events with full metadata - REDUCED LIMIT for fast loading
        supabase.from('vehicle_timeline_events').select('id, event_date, event_type, vehicle_id, user_id, metadata, cost_amount, title, description, created_at').eq('user_id', userId).order('event_date', { ascending: false }).limit(100),
        // Get image uploads (include EXIF and vehicle_id for proper grouping) - REDUCED LIMIT for fast loading
        supabase.from('vehicle_images').select('id, image_url, created_at, taken_at, exif_data, user_id, vehicle_id').eq('user_id', userId).order('taken_at', { ascending: false }).limit(100),
        // Get verifications (limited)
        supabase.from('user_verifications').select('created_at, status').eq('user_id', userId).order('created_at', { ascending: false }).limit(20),
        // Get business timeline events created by this user (organization contributions) - REDUCED LIMIT for fast loading
        supabase.from('business_timeline_events').select('id, event_date, event_type, business_id, created_by, title, description, cost_amount, metadata, created_at').eq('created_by', userId).order('event_date', { ascending: false }).limit(100),
        // Get contractor work contributions (NEW - this will show FBM work) - REDUCED LIMIT for fast loading
        supabase.from('contractor_work_contributions').select('id, work_date, work_description, work_category, labor_hours, total_value, organization_id, vehicle_id, metadata').eq('contractor_user_id', userId).eq('show_on_contractor_profile', true).order('work_date', { ascending: false }).limit(50)
      ]);

      // Debug: Log query results
      console.log('ProfileService: Query results:');
      console.log('- Profile:', profileResult.data ? 'found' : 'not found');
      console.log('- Timeline events:', vehicleTimelineResult.data?.length || 0, vehicleTimelineResult.error ? `(ERROR: ${vehicleTimelineResult.error.message})` : '');
      console.log('- Vehicle images:', vehicleImagesResult.data?.length || 0, vehicleImagesResult.error ? `(ERROR: ${vehicleImagesResult.error.message})` : '');
      console.log('- Verifications:', verificationsResult.data?.length || 0, verificationsResult.error ? `(ERROR: ${verificationsResult.error.message})` : '');
      console.log('- Business timeline events:', orgTimelineResult.data?.length || 0, orgTimelineResult.error ? `(ERROR: ${orgTimelineResult.error.message})` : '');
      console.log('- Contractor work:', contractorWorkResult.data?.length || 0, contractorWorkResult.error ? `(ERROR: ${contractorWorkResult.error.message})` : '');

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
      
      // Process organization timeline events
      if (orgTimelineResult.data) {
        orgTimelineResult.data.forEach((event: any) => {
          const raw = event.event_date || event.created_at;
          if (!raw) return;
          const date = toDateOnly(raw);
          bump(date, 'business_event', {
            metadata: { 
              event_type: event.event_type,
              title: event.title,
              description: event.description,
              business_id: event.business_id
            },
            related_vehicle_id: null,
            created_at: raw,
          });
        });
      }
      
      // Process image uploads (prefer EXIF capture date, normalized to date-only)
      // Group by vehicle_id AND date so each vehicle gets separate contributions
      const imageGroupDetailMap = new Map<string, { date: string; vehicleId: string | null; images: any[] }>();

      if (vehicleImagesResult.data) {
        console.log(`ProfileService: Processing ${vehicleImagesResult.data.length} images into contributions`);

        vehicleImagesResult.data.forEach((img: any) => {
          const takenRaw = img?.taken_at || img?.exif_data?.dateTaken || img?.exif_data?.date_taken || img?.exif_data?.DateTimeOriginal || img?.created_at;
          const date = toDateOnly(takenRaw);
          const vehicleId = img.vehicle_id || null;
          const key = `${date}|${vehicleId ?? 'none'}`;

          if (!imageGroupDetailMap.has(key)) {
            imageGroupDetailMap.set(key, { date, vehicleId, images: [] });
          }
          imageGroupDetailMap.get(key)!.images.push({ ...img, takenRaw });

          bump(date, 'image_upload', {
            created_at: takenRaw,
            related_vehicle_id: vehicleId
          });
        });

        console.log('ProfileService: Image upload groups formed:', imageGroupDetailMap.size);
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

      // ---- Build daily contribution summaries (report-style ledger) ----
      const safeNumber = (value: any): number => {
        const num = Number(value);
        return Number.isFinite(num) ? num : 0;
      };

      const vehicleIdAccumulator = new Set<string>();
      vehicleTimelineResult.data?.forEach((event: any) => {
        if (event.vehicle_id) vehicleIdAccumulator.add(event.vehicle_id);
      });
      vehicleImagesResult.data?.forEach((img: any) => {
        if (img.vehicle_id) vehicleIdAccumulator.add(img.vehicle_id);
      });

      const vehicleLookup = new Map<string, string>();
      if (vehicleIdAccumulator.size > 0) {
        const { data: vehicleInfo, error: vehicleLookupError } = await supabase
          .from('vehicles')
          .select('id, year, make, model, title')
          .in('id', Array.from(vehicleIdAccumulator));

        if (vehicleLookupError) {
          console.warn('ProfileService: Unable to resolve vehicle names for profile summaries', vehicleLookupError.message);
        } else if (vehicleInfo) {
          vehicleInfo.forEach((vehicle: any) => {
            const nameParts = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ');
            const preferredName = vehicle.title || nameParts || vehicle.id;
            vehicleLookup.set(vehicle.id, preferredName);
          });
        }
      }

      const summaryMap = new Map<string, DailyContributionSummary>();
      const ensureSummary = (date: string, vehicleId: string | null, fallbackLabel?: string): DailyContributionSummary => {
        const key = `${date}|${vehicleId ?? 'none'}`;
        if (!summaryMap.has(key)) {
          summaryMap.set(key, {
            id: key,
            date,
            vehicle_id: vehicleId,
            vehicle_name: vehicleId ? (vehicleLookup.get(vehicleId) || null) : (fallbackLabel ?? null),
            total_value_usd: 0,
            total_hours: 0,
            total_images: 0,
            total_events: 0,
            total_verifications: 0,
            highlights: []
          });
        }
        const summary = summaryMap.get(key)!;
        if (vehicleId && !summary.vehicle_name) {
          summary.vehicle_name = vehicleLookup.get(vehicleId) || summary.vehicle_name || null;
        }
        if (!vehicleId && fallbackLabel && !summary.vehicle_name) {
          summary.vehicle_name = fallbackLabel;
        }
        return summary;
      };

      const addHighlight = (summary: DailyContributionSummary, highlight: ContributionHighlight) => {
        summary.highlights.push({
          ...highlight,
          value_usd: Number((highlight.value_usd || 0).toFixed(2)),
          hours: Number((highlight.hours || 0).toFixed(2))
        });
      };

      // Vehicle timeline events (mechanical work, documentation, etc.)
      vehicleTimelineResult.data?.forEach((event: any) => {
        const raw = event.event_date || event.created_at;
        if (!raw) return;
        const date = toDateOnly(raw);
        const vehicleId = event.vehicle_id || null;
        const summary = ensureSummary(date, vehicleId, 'General Vehicle Work');
        const costAmount = safeNumber(event.cost_amount ?? event.metadata?.cost_amount);
        const durationMinutes = safeNumber(event.metadata?.duration_minutes);
        const durationHours = durationMinutes / 60;

        summary.total_events += 1;
        summary.total_value_usd += costAmount;
        summary.total_hours += durationHours;

        addHighlight(summary, {
          id: event.id || `${date}-${vehicleId ?? 'none'}-event-${summary.highlights.length}`,
          type: 'vehicle_data',
          title: event.title || event.event_type || 'Timeline Event',
          description: event.description || null,
          count: 1,
          value_usd: costAmount,
          hours: durationHours,
          metadata: {
            event_type: event.event_type,
            vehicle_id: vehicleId,
            cost_amount: costAmount,
            duration_minutes: durationMinutes,
            raw: event
          }
        });
      });

      // Business timeline events (shop/organization level)
      orgTimelineResult.data?.forEach((event: any) => {
        const raw = event.event_date || event.created_at;
        if (!raw) return;
        const date = toDateOnly(raw);
        const summary = ensureSummary(date, null, 'Business Activity');
        const costAmount = safeNumber(event.cost_amount ?? event.metadata?.cost_amount);

        summary.total_events += 1;
        summary.total_value_usd += costAmount;

        addHighlight(summary, {
          id: event.id || `${date}-business-${summary.highlights.length}`,
          type: 'business_event',
          title: event.title || event.event_type || 'Business Event',
          description: event.description || null,
          count: 1,
          value_usd: costAmount,
          hours: 0,
          metadata: {
            business_id: event.business_id,
            event_type: event.event_type,
            cost_amount: costAmount,
            raw: event
          }
        });
      });

      // Contractor work contributions (NEW - FBM work, etc.)
      contractorWorkResult.data?.forEach((work: any) => {
        const date = toDateOnly(work.work_date);
        const summary = ensureSummary(date, work.vehicle_id, 'Contractor Work');
        const totalValue = safeNumber(work.total_value);
        const hours = safeNumber(work.labor_hours);

        summary.total_events += 1;
        summary.total_value_usd += totalValue;
        summary.total_hours += hours;

        addHighlight(summary, {
          id: work.id || `${date}-contractor-${summary.highlights.length}`,
          type: 'contractor_work',
          title: work.work_description || work.work_category || 'Contractor Work',
          description: work.work_category ? `${work.work_category} work` : null,
          count: 1,
          value_usd: totalValue,
          hours: hours,
          metadata: {
            organization_id: work.organization_id,
            vehicle_id: work.vehicle_id,
            work_category: work.work_category,
            auto_generated: work.metadata?.auto_generated,
            needs_review: work.metadata?.needs_review,
            raw: work
          }
        });
      });

      // AI-enhanced image group summaries
      let aiInsightsByKey = new Map<string, ImageInsightResult>();
      if (imageGroupDetailMap.size > 0) {
        const potentialBatches: ImageInsightRequest[] = [];
        for (const [key, group] of imageGroupDetailMap) {
          if (!group.images || group.images.length < 2) continue;
          potentialBatches.push({
            batchId: key,
            vehicleId: group.vehicleId,
            vehicleName: group.vehicleId ? vehicleLookup.get(group.vehicleId) || null : 'Multiple Vehicles',
            userId,
            date: group.date,
            images: group.images.slice(0, 8).map((img: any) => ({
              id: img.id,
              url: img.image_url,
              takenAt: img.taken_at || img.created_at || null
            }))
          });
        }

        const batches = potentialBatches
          .sort((a, b) => b.date.localeCompare(a.date))
          .slice(0, 6);

        if (batches.length) {
          const batchIds = batches.map((batch) => batch.batchId);
          const { data: cachedInsights } = await supabase
            .from('profile_image_insights')
            .select(`
              batch_id,
              summary,
              condition_score,
              condition_label,
              estimated_value_usd,
              labor_hours,
              confidence,
              key_findings,
              recommendations
            `)
            .eq('user_id', userId)
            .in('batch_id', batchIds);

          aiInsightsByKey = new Map(
            (cachedInsights || []).map((item: any) => [item.batch_id, {
              batchId: item.batch_id,
              summary: item.summary,
              conditionScore: item.condition_score,
              conditionLabel: item.condition_label,
              estimatedValueUsd: item.estimated_value_usd,
              laborHours: item.labor_hours,
              confidence: item.confidence,
              keyFindings: item.key_findings || [],
              recommendations: item.recommendations || []
            } as ImageInsightResult])
          );

          const missingBatches = batches.filter((batch) => !aiInsightsByKey.has(batch.batchId));
          if (missingBatches.length) {
            try {
              const generated = await AIInsightsService.analyzeImageGroups(missingBatches);
              generated.forEach((insight) => {
                aiInsightsByKey.set(insight.batchId, insight);
              });
            } catch (error) {
              console.warn('ProfileService: AI image insight generation failed', error);
            }
          }
        }
      }

      imageGroupDetailMap.forEach((group, key) => {
        const summary = ensureSummary(group.date, group.vehicleId, 'Media Uploads');
        summary.total_images += group.images.length;

        const aiInsight = aiInsightsByKey.get(key) || null;
        const rawValueImpact = aiInsight?.estimatedValueUsd != null ? Number(aiInsight.estimatedValueUsd) : 0;
        const rawLaborHours = aiInsight?.laborHours != null ? Number(aiInsight.laborHours) : 0;
        const valueImpact = Number.isFinite(rawValueImpact) ? rawValueImpact : 0;
        const laborHours = Number.isFinite(rawLaborHours) ? rawLaborHours : 0;

        if (valueImpact) summary.total_value_usd += valueImpact;
        if (laborHours) summary.total_hours += laborHours;

        const keyFinding = aiInsight?.keyFindings?.[0];
        const vehicleLabel = summary.vehicle_name || (group.vehicleId ? (vehicleLookup.get(group.vehicleId) || 'Vehicle') : 'Documentation');
        const aiDescription = keyFinding
          ? `${keyFinding.title}${keyFinding.detail ? ': ' + keyFinding.detail : ''}`
          : null;
        const fallbackDescription = aiInsight ? null : `${group.images.length} images documented for ${vehicleLabel}.`;

        addHighlight(summary, {
          id: `${key}-images`,
          type: 'image_upload',
          title: aiInsight?.summary || `Condition documentation – ${vehicleLabel}`,
          description: aiDescription || fallbackDescription,
          count: group.images.length,
          value_usd: valueImpact,
          hours: laborHours,
          metadata: {
            vehicle_id: group.vehicleId,
            vehicle_name: vehicleLabel,
            sample_images: group.images.slice(0, 4).map((img: any) => ({ id: img.id, url: img.image_url })),
            ai_insight: aiInsight
          }
        });
      });

      // Verification history
      verificationsResult.data?.forEach((verification: any, index: number) => {
        const date = toDateOnly(verification.created_at);
        const summary = ensureSummary(date, null, 'Account & Verification');

        summary.total_verifications += 1;

        addHighlight(summary, {
          id: `verification-${date}-${index}`,
          type: 'verification',
          title: `Verification ${verification.status || 'update'}`,
          description: null,
          count: 1,
          value_usd: 0,
          hours: 0,
          metadata: {
            status: verification.status,
            raw: verification
          }
        });
      });

      const dailyContributionSummaries = Array.from(summaryMap.values()).map((summary) => {
        const orderedHighlights = summary.highlights.sort((a, b) => {
          if (b.value_usd !== a.value_usd) return b.value_usd - a.value_usd;
          if (b.hours !== a.hours) return b.hours - a.hours;
          return b.count - a.count;
        });

        return {
          ...summary,
          total_value_usd: Number(summary.total_value_usd.toFixed(2)),
          total_hours: Number(summary.total_hours.toFixed(2)),
          highlights: orderedHighlights
        };
      }).sort((a, b) => {
        if (a.date === b.date) {
          return (b.total_value_usd || 0) - (a.total_value_usd || 0);
        }
        return b.date.localeCompare(a.date);
      });

      return {
        profile: profileResult.data,
        completion: completionResult.data || null,
        achievements: achievementsResult.data || [],
        recentActivity: activityResult.data || [],
        stats: statsResult.data || null,
        recentContributions: finalContributions, // Prioritize timeline-built data over table data
        dailyContributionSummaries,
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
        dailyContributionSummaries: [],
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
