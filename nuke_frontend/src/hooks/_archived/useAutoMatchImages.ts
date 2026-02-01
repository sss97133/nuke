/**
 * Hook for auto-matching unorganized images to vehicles
 */

import { useState, useCallback } from 'react';
import { ImageVehicleMatcher, ImageMatchResult } from '../services/imageVehicleMatcher';

export interface UseAutoMatchImagesResult {
  matching: boolean;
  matches: ImageMatchResult[];
  error: string | null;
  matchImages: (imageIds: string[]) => Promise<void>;
  matchUserImages: (userId: string) => Promise<void>;
  applyMatches: () => Promise<{ success: number; failed: number }>;
}

export function useAutoMatchImages(): UseAutoMatchImagesResult {
  const [matching, setMatching] = useState(false);
  const [matches, setMatches] = useState<ImageMatchResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  const matchImages = useCallback(async (imageIds: string[]) => {
    setMatching(true);
    setError(null);
    try {
      const results = await ImageVehicleMatcher.matchImages(imageIds);
      setMatches(results);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Matching failed';
      setError(errorMessage);
      console.error('Auto-match error:', err);
    } finally {
      setMatching(false);
    }
  }, []);

  const matchUserImages = useCallback(async (userId: string) => {
    setMatching(true);
    setError(null);
    try {
      const results = await ImageVehicleMatcher.matchUserUnorganizedImages(userId);
      setMatches(results);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Matching failed';
      setError(errorMessage);
      console.error('Auto-match error:', err);
    } finally {
      setMatching(false);
    }
  }, []);

  const applyMatches = useCallback(async () => {
    if (matches.length === 0) {
      return { success: 0, failed: 0 };
    }

    setMatching(true);
    setError(null);
    try {
      const result = await ImageVehicleMatcher.applyMatches(matches);
      // Clear matches after applying
      setMatches([]);
      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to apply matches';
      setError(errorMessage);
      console.error('Apply matches error:', err);
      return { success: 0, failed: matches.length };
    } finally {
      setMatching(false);
    }
  }, [matches]);

  return {
    matching,
    matches,
    error,
    matchImages,
    matchUserImages,
    applyMatches
  };
}

