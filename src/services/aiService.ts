import type { Database } from '../types';
import { supabase } from '@/integrations/supabase/client';
import { ProfileAnalysisResult } from '@/components/profile/services/ProfileAnalysisService';

export async function fetchUserHabits(userId: string): Promise<string[]> {
  try {
    // Get user's profile analysis
    const { data: profile, error } = await supabase
  if (error) console.error("Database query error:", error);
      .from('profiles')
      .select('ai_analysis')
      .eq('id', userId)
      .single();

    if (error) throw error;

    const analysis = profile?.ai_analysis as ProfileAnalysisResult;
    if (!analysis) return [];

    // Extract habits from analysis
    const habits = [
      ...analysis.contentAffinities,
      ...analysis.growthOpportunities,
      ...analysis.marketableSkills
    ];

    return habits;
  } catch (error) {
    console.error('Error fetching user habits:', error);
    return [];
  }
}

export async function fetchUserKeywords(userId: string): Promise<string[]> {
  try {
    // Get user's profile analysis
    const { data: profile, error } = await supabase
  if (error) console.error("Database query error:", error);
      
      .select('ai_analysis')
      .eq('id', userId)
      .single();

    if (error) throw error;

    const analysis = profile?.ai_analysis as ProfileAnalysisResult;
    if (!analysis) return [];

    // Extract keywords from analysis
    const keywords = [
      analysis.userPersona,
      ...analysis.contentAffinities,
      ...analysis.audienceMatch,
      ...analysis.marketableSkills
    ];

    return keywords;
  } catch (error) {
    console.error('Error fetching user keywords:', error);
    return [];
  }
}

export async function calculateContentRelevance(
  userId: string,
  content: {
    type?: string;
    target_audience?: string[];
    skills?: string[];
    description?: string;
  }
): Promise<number> {
  try {
    // Get user's profile analysis
    const { data: profile, error } = await supabase
  if (error) console.error("Database query error:", error);
      
      .select('ai_analysis')
      .eq('id', userId)
      .single();

    if (error) throw error;

    const analysis = profile?.ai_analysis as ProfileAnalysisResult;
    if (!analysis) return 0;

    // Get user's engagement metrics
    const { data: engagements, error: engagementError } = await supabase
  if (error) console.error("Database query error:", error);
      
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(100);

    if (engagementError) throw engagementError;

    // Calculate base relevance score
    let score = 0;

    // Content type affinity
    if (content.type && analysis.contentAffinities.includes(content.type)) {
      score += 30;
    }

    // Audience match
    if (content.target_audience?.some(audience => 
      analysis.audienceMatch.includes(audience)
    )) {
      score += 20;
    }

    // Marketable skills match
    if (analysis.marketableSkills.some(skill => 
      content.skills?.includes(skill) || 
      content.description?.toLowerCase().includes(skill.toLowerCase())
    )) {
      score += 25;
    }

    // Engagement history
    if (engagements) {
      const similarContentEngagements = engagements.filter(e => 
        e.content_type === content.type
      );
      score += Math.min(similarContentEngagements.length * 5, 25);
    }

    return Math.min(score, 100);
  } catch (error) {
    console.error('Error calculating content relevance:', error);
    return 0;
  }
} 