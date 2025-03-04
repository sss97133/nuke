
import { useState, useEffect } from 'react';
import { ProfileAnalysisService } from '../services/ProfileAnalysisService';
import { SocialLinks, StreamingLinks, Achievement } from '../types';

export type AnalysisResult = {
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
  isReady: boolean;
};

export const useProfileAnalysis = (
  userId: string | undefined,
  profileData: any | null,
  achievements: Achievement[] | null,
  socialLinks: SocialLinks,
  streamingLinks: StreamingLinks
) => {
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult>({
    userPersona: '',
    contentAffinities: [],
    developerSpectrum: { viewer: 0, owner: 0, technician: 0, investor: 0 },
    privacyRecommendation: 'limited',
    growthOpportunities: [],
    audienceMatch: [],
    marketableSkills: [],
    professionalScore: 0,
    collectorScore: 0,
    creatorScore: 0,
    enthusiastScore: 0,
    isReady: false
  });
  
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const runAnalysis = async () => {
      if (!userId || !profileData) return;
      
      console.log('Starting profile analysis in hook for user:', userId);
      setIsLoading(true);
      setError(null);
      
      try {
        const result = await ProfileAnalysisService.analyzeProfile(
          profileData,
          achievements,
          socialLinks,
          streamingLinks
        );
        
        console.log('Analysis completed in hook:', result);
        setAnalysisResult({ ...result, isReady: true });
        
        // Save results to database
        await ProfileAnalysisService.saveAnalysisResults(userId, result);
      } catch (err) {
        console.error('Error in profile analysis hook:', err);
        setError(err instanceof Error ? err : new Error('Unknown error in profile analysis'));
      } finally {
        setIsLoading(false);
      }
    };
    
    runAnalysis();
  }, [userId, profileData, achievements, socialLinks, streamingLinks]);

  return {
    analysisResult,
    isLoading,
    error,
    refreshAnalysis: async () => {
      if (!userId || !profileData) {
        console.log('Cannot refresh analysis: userId or profileData is missing');
        return;
      }
      
      console.log('Manually refreshing profile analysis for user:', userId);
      setIsLoading(true);
      setError(null);
      
      try {
        const result = await ProfileAnalysisService.analyzeProfile(
          profileData,
          achievements,
          socialLinks,
          streamingLinks
        );
        
        console.log('Manual analysis refresh completed:', result);
        setAnalysisResult({ ...result, isReady: true });
        
        // Save results to database
        await ProfileAnalysisService.saveAnalysisResults(userId, result);
      } catch (err) {
        console.error('Error in manual profile analysis refresh:', err);
        setError(err instanceof Error ? err : new Error('Unknown error in profile analysis'));
      } finally {
        setIsLoading(false);
      }
    }
  };
};
