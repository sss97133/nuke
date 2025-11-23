import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';

interface AutoTagResult {
  success: boolean;
  detected_objects: number;
  created_tags: number;
  tags: any[];
  error?: string;
}

export const useAutoTagging = () => {
  const [isTagging, setIsTagging] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  const autoTagImage = useCallback(async (
    imageUrl: string,
    imageId: string,
    vehicleId: string,
    userId: string,
    timestamp: string
  ): Promise<AutoTagResult> => {
    setIsTagging(true);
    setProgress('Detecting objects...');

    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/auto-tag-objects`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token}`
          },
          body: JSON.stringify({
            image_url: imageUrl,
            image_id: imageId,
            vehicle_id: vehicleId,
            user_id: userId,
            timestamp: timestamp
          })
        }
      );

      if (!response.ok) {
        throw new Error('Auto-tagging failed');
      }

      const result = await response.json();
      
      setProgress(null);
      setIsTagging(false);

      return result;
    } catch (error) {
      console.error('Auto-tagging error:', error);
      setProgress(null);
      setIsTagging(false);

      return {
        success: false,
        detected_objects: 0,
        created_tags: 0,
        tags: [],
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }, []);

  return {
    autoTagImage,
    isTagging,
    progress
  };
};

