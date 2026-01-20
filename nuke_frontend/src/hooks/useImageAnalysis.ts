import { useState } from 'react';
import { supabase } from '../lib/supabase';

interface AutomatedTag {
  tag_name: string;
  tag_type: 'part' | 'tool' | 'brand' | 'process' | 'issue' | 'custom';
  confidence: number;
  x_position: number;
  y_position: number;
  width: number;
  height: number;
  ai_detection_data: any;
}

interface AnalysisResult {
  success: boolean;
  tags: AutomatedTag[];
  source: 'cache' | 'rekognition';
  cached?: boolean;
  error?: string;
}

export const useImageAnalysis = () => {
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState<string>('');

  const analyzeImage = async (
    imageUrl: string,
    timelineEventId?: string,
    vehicleId?: string,
    options?: {
      imageId?: string | null;
      userId?: string | null;
      forceReprocess?: boolean;
    }
  ): Promise<AnalysisResult> => {
    setAnalyzing(true);
    setAnalysisProgress('Starting image analysis...');

    try {
      // Call the Supabase Edge Function
      setAnalysisProgress('Sending image to AI analysis service...');

      const { data, error } = await supabase.functions.invoke('analyze-image', {
        body: {
          image_url: imageUrl,
          image_id: options?.imageId ?? null,
          timeline_event_id: timelineEventId,
          vehicle_id: vehicleId,
          user_id: options?.userId ?? null,
          force_reprocess: Boolean(options?.forceReprocess)
        }
      });

      if (error) {
        console.error('Analysis error:', error);
        return {
          success: false,
          tags: [],
          source: 'cache',
          error: error.message
        };
      }

      setAnalysisProgress('Processing AI detection results...');

      // The function should return the tags and insert them automatically
      const cached = Boolean((data as any)?.cached);
      return {
        success: Boolean((data as any)?.success),
        tags: (data as any)?.tags || [],
        source: cached ? 'cache' : 'rekognition',
        cached
      };

    } catch (error) {
      console.error('Image analysis failed:', error);
      return {
        success: false,
        tags: [],
        source: 'cache',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    } finally {
      setAnalyzing(false);
      setAnalysisProgress('');
    }
  };

  const analyzeImageBatch = async (
    images: Array<{ url: string; timelineEventId?: string; vehicleId?: string }>
  ): Promise<AnalysisResult[]> => {
    setAnalyzing(true);
    const results: AnalysisResult[] = [];

    for (let i = 0; i < images.length; i++) {
      const image = images[i];
      setAnalysisProgress(`Analyzing image ${i + 1} of ${images.length}...`);

      const result = await analyzeImage(image.url, image.timelineEventId, image.vehicleId);
      results.push(result);

      // Small delay to avoid overwhelming the service
      if (i < images.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    setAnalyzing(false);
    setAnalysisProgress('');
    return results;
  };

  // Check if an image has been analyzed recently
  const checkAnalysisStatus = async (imageUrl: string) => {
    try {
      const { data, error } = await supabase
        .from('image_analysis_cache')
        .select('last_analyzed, analysis_version')
        .eq('image_url', imageUrl)
        .single();

      if (error || !data) {
        return { analyzed: false, lastAnalyzed: null };
      }

      const lastAnalyzed = new Date(data.last_analyzed);
      const isRecent = lastAnalyzed > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days

      return {
        analyzed: isRecent,
        lastAnalyzed: lastAnalyzed,
        version: data.analysis_version
      };
    } catch (error) {
      console.error('Error checking analysis status:', error);
      return { analyzed: false, lastAnalyzed: null };
    }
  };

  // Get AI-suggested tags for an image (without running analysis)
  const getSuggestedTags = async (imageUrl: string) => {
    try {
      const { data, error } = await supabase
        .from('image_tags')
        .select('tag_name, tag_type, confidence, verified, ai_detection_data')
        .eq('image_url', imageUrl)
        .eq('verified', false) // AI-generated tags
        .order('confidence', { ascending: false });

      if (error) {
        console.error('Error fetching suggested tags:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Error getting suggested tags:', error);
      return [];
    }
  };

  // Verify an AI-generated tag (convert to manual/verified)
  const verifyAITag = async (tagId: string, userId: string) => {
    try {
      const { error } = await supabase
        .from('image_tags')
        .update({
          verified: true,
          created_by: userId,
          verified_at: new Date().toISOString()
        })
        .eq('id', tagId);

      if (error) {
        console.error('Error verifying AI tag:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error verifying AI tag:', error);
      return false;
    }
  };

  // Reject an AI-generated tag
  const rejectAITag = async (tagId: string) => {
    try {
      const { error } = await supabase
        .from('image_tags')
        .delete()
        .eq('id', tagId)
        .eq('verified', false); // Only delete unverified AI tags

      if (error) {
        console.error('Error rejecting AI tag:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error rejecting AI tag:', error);
      return false;
    }
  };

  return {
    analyzing,
    analysisProgress,
    analyzeImage,
    analyzeImageBatch,
    checkAnalysisStatus,
    getSuggestedTags,
    verifyAITag,
    rejectAITag
  };
};