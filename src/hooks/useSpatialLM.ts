import { useState, useEffect } from 'react';
import { SpatialLMIntegration } from '@/integrations/spatiallm/SpatialLMIntegration';
import type { PTZTrack, WorkspaceDimensions } from '@/components/studio/types/workspace';

interface UseSpatialLMProps {
  dimensions: WorkspaceDimensions;
  ptzTracks: PTZTrack[];
  onOptimizedPositions?: (positions: PTZTrack[]) => void;
  onAnalysisUpdate?: (analysis: {
    coverageScore: number;
    blindSpots: Array<{
      position: { x: number; y: number; z: number };
      radius: number;
    }>;
  }) => void;
}

export function useSpatialLM({
  dimensions,
  ptzTracks,
  onOptimizedPositions,
  onAnalysisUpdate
}: UseSpatialLMProps) {
  const [isInitialized, setIsInitialized] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const initializeSpatialLM = async () => {
      try {
        const spatialLM = new SpatialLMIntegration({
          modelPath: '/models/spatiallm',
          device: 'cuda',
          batchSize: 32
        });
        await spatialLM.initialize();
        setIsInitialized(true);
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Failed to initialize SpatialLM'));
      }
    };

    initializeSpatialLM();
  }, []);

  const analyzeWorkspace = async () => {
    if (!isInitialized) {
      setError(new Error('SpatialLM not initialized'));
      return;
    }

    setIsAnalyzing(true);
    setError(null);

    try {
      const spatialLM = new SpatialLMIntegration({
        modelPath: '/models/spatiallm',
        device: 'cuda',
        batchSize: 32
      });
      await spatialLM.initialize();

      const analysis = await spatialLM.analyzeWorkspace(dimensions, ptzTracks);
      onAnalysisUpdate?.({
        coverageScore: analysis.coverageScore,
        blindSpots: analysis.blindSpots
      });
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to analyze workspace'));
    } finally {
      setIsAnalyzing(false);
    }
  };

  const optimizePositions = async (targetCoverage: number = 0.95) => {
    if (!isInitialized) {
      setError(new Error('SpatialLM not initialized'));
      return;
    }

    setIsOptimizing(true);
    setError(null);

    try {
      const spatialLM = new SpatialLMIntegration({
        modelPath: '/models/spatiallm',
        device: 'cuda',
        batchSize: 32
      });
      await spatialLM.initialize();

      const optimizedPositions = await spatialLM.optimizeCameraPositions(
        dimensions,
        ptzTracks,
        targetCoverage
      );
      onOptimizedPositions?.(optimizedPositions);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to optimize positions'));
    } finally {
      setIsOptimizing(false);
    }
  };

  return {
    isInitialized,
    isAnalyzing,
    isOptimizing,
    error,
    analyzeWorkspace,
    optimizePositions
  };
} 