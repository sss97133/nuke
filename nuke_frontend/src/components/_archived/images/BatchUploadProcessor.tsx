import React, { useEffect, useState } from 'react';
import { WorkSessionAnalyzer } from '../../services/workSessionAnalyzer';

interface BatchUploadProcessorProps {
  vehicleId: string;
  userId: string;
  recentImageIds: string[]; // IDs of images just uploaded
  onProcessed?: () => void;
}

/**
 * Invisible component that processes batched uploads into intelligent work sessions
 * 
 * After user uploads multiple photos, this:
 * 1. Waits a few seconds for batch to complete
 * 2. Analyzes all images with AI
 * 3. Creates ONE meaningful timeline event instead of 100 "Photo Added" entries
 */
export const BatchUploadProcessor: React.FC<BatchUploadProcessorProps> = ({
  vehicleId,
  userId,
  recentImageIds,
  onProcessed
}) => {
  const [processing, setProcessing] = useState(false);
  const [batchQueue, setBatchQueue] = useState<string[]>([]);

  // Accumulate uploads over 5 seconds
  useEffect(() => {
    if (recentImageIds.length === 0) return;

    setBatchQueue(prev => [...new Set([...prev, ...recentImageIds])]);

    // Wait 5 seconds after last upload to process batch
    const timer = setTimeout(async () => {
      if (batchQueue.length > 0) {
        setProcessing(true);
        
        console.log(`🔍 Analyzing ${batchQueue.length} photos to create work session...`);
        
        const result = await WorkSessionAnalyzer.analyzeAndCreateWorkSession(
          vehicleId,
          batchQueue,
          userId
        );

        if (result.success) {
          console.log(`✅ Created intelligent work session event instead of ${batchQueue.length} individual photo events`);
        } else {
          console.warn('⚠️ Work session analysis failed:', result.error);
        }

        setBatchQueue([]);
        setProcessing(false);
        onProcessed?.();
      }
    }, 5000);

    return () => clearTimeout(timer);
  }, [recentImageIds, vehicleId, userId, batchQueue.length, onProcessed]);

  // Invisible component
  return null;
};

/**
 * Hook to use batch upload processor
 */
export function useBatchUploadProcessor(vehicleId: string, userId?: string) {
  const [recentUploads, setRecentUploads] = useState<string[]>([]);

  const addToQueue = (imageId: string) => {
    setRecentUploads(prev => [...prev, imageId]);
  };

  const clearQueue = () => {
    setRecentUploads([]);
  };

  return {
    recentUploads,
    addToQueue,
    clearQueue,
    ProcessorComponent: userId ? (
      <BatchUploadProcessor
        vehicleId={vehicleId}
        userId={userId}
        recentImageIds={recentUploads}
        onProcessed={clearQueue}
      />
    ) : null
  };
}

