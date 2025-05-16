
/**
 * Service for analyzing user profile data and generating insights
 */
import type { Database } from '../types';
import { SocialLinks, StreamingLinks, Achievement } from '../types';
import { supabase } from '@/integrations/supabase/client';

export type ProfileAnalysisResult = {
  userPersona: string;
  contentAffinities: string[];
  developerSpectrum: Record<string, number>;
  privacyRecommendation: 'public' | 'limited' | 'private';
  growthOpportunities: string[];
  audienceMatch: string[];
  marketableSkills: string[];
  professionalScore: number;
  collectorScore: number;
  creatorScore: number;
  enthusiastScore: number;
  recommendedConnections?: string[];
};

export class ProfileAnalysisService {
  /**
   * Analyze profile data to generate insights
   */
  static async analyzeProfile(
    profileData: any, 
    achievements: Achievement[] | null,
    socialLinks: SocialLinks,
    streamingLinks: StreamingLinks
  ): Promise<ProfileAnalysisResult> {
    console.log('Starting profile analysis for user:', profileData?.id);
    console.log('Analyzing profile data:', { 
      profileType: profileData?.user_type,
      achievementsCount: achievements?.length || 0,
      hasSocialLinks: Object.values(socialLinks).some(link => !!link),
      hasStreamingLinks: Object.values(streamingLinks).some(link => !!link)
    });

    try {
      // In a production environment, this could call an LLM API
      // For now, we'll use simple heuristic analysis

      // Calculate scores based on profile completeness and activity
      const professionalScore = this.calculateProfessionalScore(profileData, socialLinks);
      const collectorScore = this.calculateCollectorScore(profileData, achievements);
      const creatorScore = this.calculateCreatorScore(profileData, streamingLinks);
      const enthusiastScore = this.calculateEnthusiastScore(profileData, achievements);

      console.log('Profile scores calculated:', {
        professionalScore,
        collectorScore,
        creatorScore,
        enthusiastScore
      });

      // Determine primary user persona
      const scores = {
        'Professional': professionalScore,
        'Collector': collectorScore,
        'Creator': creatorScore,
        'Enthusiast': enthusiastScore
      };
      
      const primaryPersona = Object.entries(scores)
        .sort((a, b) => b[1] - a[1])[0][0];

      // Generate analysis result
      const result: ProfileAnalysisResult = {
        userPersona: primaryPersona,
        contentAffinities: this.generateContentAffinities(primaryPersona, profileData),
        developerSpectrum: {
          viewer: Math.round(Math.min(enthusiastScore * 1.5, 100)),
          owner: Math.round(Math.min(collectorScore * 1.2, 100)),
          technician: Math.round(Math.min(professionalScore * 1.3, 100)),
          investor: Math.round(Math.min((collectorScore + professionalScore) / 2, 100))
        },
        privacyRecommendation: this.determinePrivacyRecommendation(primaryPersona),
        growthOpportunities: this.identifyGrowthOpportunities(profileData, primaryPersona),
        audienceMatch: this.determineAudienceMatch(primaryPersona),
        marketableSkills: this.identifyMarketableSkills(profileData, achievements),
        professionalScore,
        collectorScore,
        creatorScore,
        enthusiastScore
      };

      console.log('Profile analysis completed successfully', { primaryPersona });
      return result;
    } catch (error) {
      console.error('Profile analysis failed:', error);
      // Return default values on error
      return {
        userPersona: 'Enthusiast',
        contentAffinities: ['Automotive News', 'Vehicle Reviews'],
        developerSpectrum: { viewer: 50, owner: 30, technician: 20, investor: 10 },
        privacyRecommendation: 'limited',
        growthOpportunities: ['Complete profile', 'Connect social accounts'],
        audienceMatch: ['Casual browsers'],
        marketableSkills: [],
        professionalScore: 0,
        collectorScore: 0,
        creatorScore: 0,
        enthusiastScore: 50
      };
    }
  }

  /**
   * Save analysis results to database for future reference
   */
  static async saveAnalysisResults(userId: string, analysisResults: ProfileAnalysisResult): Promise<void> {
    try {
      console.log('Saving analysis results for user:', userId);
      
      const { error } = await supabase
        .from('profiles')
        .update({
          ai_analysis: analysisResults,
          updated_at: new Date().toISOString()
        })
        .eq('id', userId);
        
      if (error) {
        console.error('Error saving analysis results:', error);
        throw error;
      }
      
      console.log('Analysis results saved successfully');
    } catch (error) {
      console.error('Failed to save analysis results:', error);
    }
  }

  private static calculateProfessionalScore(profile: any, socialLinks: SocialLinks): number {
    let score = 0;
    
    // Professional users likely have complete profiles
    if (profile?.full_name) score += 10;
    if (profile?.bio && profile.bio.length > 50) score += 15;
    if (profile?.avatar_url) score += 10;
    
    // Professional users likely have business social links
    if (socialLinks?.linkedin) score += 20;
    if (socialLinks?.twitter) score += 10;
    
    // Additional factors
    if (profile?.user_type === 'professional') score += 25;
    
    return Math.min(score, 100);
  }
  
  private static calculateCollectorScore(profile: any, achievements: Achievement[] | null): number {
    let score = 0;
    
    // Collectors likely have achievements related to vehicles
    const collectionAchievements = achievements?.filter(a => 
      a.achievement_type.includes('collect') || 
      a.achievement_type.includes('vehicle') ||
      a.achievement_type.includes('discover')
    );
    
    if (collectionAchievements && collectionAchievements.length > 0) {
      score += Math.min(collectionAchievements.length * 10, 50);
    }
    
    // Additional factors
    if (profile?.discovery_count && profile.discovery_count > 0) {
      score += Math.min(profile.discovery_count * 5, 40);
    }
    
    return Math.min(score, 100);
  }
  
  private static calculateCreatorScore(profile: any, streamingLinks: StreamingLinks): number {
    let score = 0;
    
    // Creators likely have streaming accounts
    if (streamingLinks?.twitch) score += 20;
    if (streamingLinks?.youtube) score += 20;
    if (streamingLinks?.tiktok) score += 15;
    
    // Creators likely have a detailed bio
    if (profile?.bio && profile.bio.length > 100) score += 15;
    
    // Creators likely have a profile image
    if (profile?.avatar_url) score += 10;
    
    return Math.min(score, 100);
  }
  
  private static calculateEnthusiastScore(profile: any, achievements: Achievement[] | null): number {
    // Everyone starts with a base enthusiast score
    let score = 30;
    
    // Engagement with platform increases enthusiast score
    if (achievements && achievements.length > 0) {
      score += Math.min(achievements.length * 5, 30);
    }
    
    // Complete profile indicates platform engagement
    if (profile?.full_name) score += 5;
    if (profile?.bio) score += 10;
    if (profile?.avatar_url) score += 5;
    
    return Math.min(score, 100);
  }
  
  private static generateContentAffinities(persona: string, profile: any): string[] {
    const baseAffinities = ['Automotive News', 'Vehicle Reviews'];
    
    switch (persona) {
      case 'Professional':
        return [...baseAffinities, 'Industry Trends', 'Business Networking', 'Technical Documentation'];
      case 'Collector':
        return [...baseAffinities, 'Rare Vehicles', 'Auctions', 'Restoration Tips', 'Value Trends'];
      case 'Creator':
        return [...baseAffinities, 'Content Creation', 'Audience Growth', 'Trending Topics', 'Collaboration Opportunities'];
      case 'Enthusiast':
      default:
        return [...baseAffinities, 'DIY Guides', 'Community Events', 'Enthusiast Meetups'];
    }
  }
  
  private static determinePrivacyRecommendation(persona: string): 'public' | 'limited' | 'private' {
    switch (persona) {
      case 'Professional':
      case 'Creator':
        return 'public';
      case 'Collector':
        return 'limited';
      case 'Enthusiast':
      default:
        return 'limited';
    }
  }
  
  private static identifyGrowthOpportunities(profile: any, persona: string): string[] {
    const opportunities = [];
    
    if (!profile?.bio || profile.bio.length < 50) {
      opportunities.push('Add a detailed bio');
    }
    
    if (!profile?.avatar_url) {
      opportunities.push('Upload a profile picture');
    }
    
    switch (persona) {
      case 'Professional':
        opportunities.push('Connect with industry professionals');
        opportunities.push('Showcase expertise through content');
        break;
      case 'Collector':
        opportunities.push('Document your collection');
        opportunities.push('Connect with other collectors');
        break;
      case 'Creator':
        opportunities.push('Cross-promote on social platforms');
        opportunities.push('Engage with audience through streams');
        break;
      case 'Enthusiast':
        opportunities.push('Join discussions on topics of interest');
        opportunities.push('Participate in community events');
        break;
    }
    
    return opportunities;
  }
  
  private static determineAudienceMatch(persona: string): string[] {
    switch (persona) {
      case 'Professional':
        return ['Industry Professionals', 'Business Clients', 'Technical Enthusiasts'];
      case 'Collector':
        return ['Fellow Collectors', 'Enthusiasts', 'Potential Buyers'];
      case 'Creator':
        return ['Content Viewers', 'Fellow Creators', 'Brand Sponsors'];
      case 'Enthusiast':
      default:
        return ['Community Members', 'Like-minded Enthusiasts'];
    }
  }
  
  private static identifyMarketableSkills(profile: any, achievements: Achievement[] | null): string[] {
    const skills = [];
    
    // Extract skills based on achievements
    achievements?.forEach(achievement => {
      if (achievement.achievement_type.includes('technical')) {
        skills.push('Technical Knowledge');
      }
      if (achievement.achievement_type.includes('restoration')) {
        skills.push('Restoration Expertise');
      }
      if (achievement.achievement_type.includes('content')) {
        skills.push('Content Creation');
      }
    });
    
    // Add default skills based on profile data
    if (profile?.user_type === 'professional') {
      skills.push('Industry Expertise');
    }
    
    return [...new Set(skills)]; // Remove duplicates
  }
}
