/**
 * Custom hook for mobile camera capture functionality
 * Provides optimized mobile capture experience with offline support
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { AIImageProcessingService, ProcessingContext } from '../services/aiImageProcessingService';
import { ImageUploadService } from '../services/imageUploadService';

export interface CaptureOptions {
  enableOfflineQueue?: boolean;
  autoProcessing?: boolean;
  batchMode?: boolean;
  maxBatchSize?: number;
}

export interface CaptureState {
  isCapturing: boolean;
  captureCount: number;
  queuedCount: number;
  lastError?: string;
  processingProgress?: number;
}

export interface CaptureResult {
  success: boolean;
  imageId?: string;
  vehicleId?: string;
  category?: string;
  error?: string;
}

export const useMobileCameraCapture = (options: CaptureOptions = {}) => {
  const { user } = useAuth();
  const [state, setState] = useState<CaptureState>({
    isCapturing: false,
    captureCount: 0,
    queuedCount: 0
  });

  const captureQueue = useRef<File[]>([]);
  const processingRef = useRef<boolean>(false);
  const contextRef = useRef<ProcessingContext | null>(null);

  // Initialize context
  useEffect(() => {
    if (user) {
      initializeContext();
    }
  }, [user]);

  const initializeContext = async () => {
    if (!user) return;

    // Load recent activity
    const recentActivity = {
      lastVehicleId: localStorage.getItem(`lastVehicle_${user.id}`),
      lastCategory: localStorage.getItem(`lastCategory_${user.id}`),
      lastWorkType: localStorage.getItem(`lastWorkType_${user.id}`)
    };

    // Get current location if permission granted
    let location: { lat: number; lng: number } | undefined;
    if ('geolocation' in navigator) {
      try {
        const position = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            timeout: 5000,
            enableHighAccuracy: false
          });
        });
        location = {
          lat: position.coords.latitude,
          lng: position.coords.longitude
        };
      } catch (error) {
        console.log('Location not available:', error);
      }
    }

    contextRef.current = {
      userId: user.id,
      location,
      recentActivity: {
        lastVehicleId: recentActivity.lastVehicleId || undefined,
        lastCategory: recentActivity.lastCategory || undefined,
        lastWorkType: recentActivity.lastWorkType || undefined
      }
    };
  };

  /**
   * Capture and process images
   */
  const captureImages = useCallback(async (files: FileList): Promise<CaptureResult[]> => {
    if (!user || !contextRef.current) {
      return [{ success: false, error: 'User not authenticated' }];
    }

    setState(prev => ({ ...prev, isCapturing: true, lastError: undefined }));
    const results: CaptureResult[] = [];

    try {
      // Add files to queue if batch mode
      if (options.batchMode) {
        captureQueue.current.push(...Array.from(files));
        
        // Process batch if queue is full
        if (captureQueue.current.length >= (options.maxBatchSize || 5)) {
          results.push(...await processBatch());
        } else {
          // Just acknowledge capture
          setState(prev => ({ 
            ...prev, 
            queuedCount: captureQueue.current.length 
          }));
          results.push({ success: true });
        }
      } else {
        // Process immediately
        for (const file of Array.from(files)) {
          const result = await processImage(file);
          results.push(result);
        }
      }

      // Update capture count
      setState(prev => ({ 
        ...prev, 
        captureCount: prev.captureCount + files.length 
      }));

    } catch (error) {
      console.error('Capture error:', error);
      setState(prev => ({ 
        ...prev, 
        lastError: 'Failed to process images' 
      }));
      results.push({ success: false, error: 'Processing failed' });
    } finally {
      setState(prev => ({ ...prev, isCapturing: false }));
    }

    return results;
  }, [user, options]);

  /**
   * Process a single image with AI
   */
  const processImage = async (file: File): Promise<CaptureResult> => {
    if (!contextRef.current) {
      return { success: false, error: 'No context available' };
    }

    try {
      // AI processing with guardrails
      const aiResult = await AIImageProcessingService.processImageWithAI(
        file,
        contextRef.current
      );

      if (!aiResult.success || !aiResult.filingDecision.vehicleId) {
        // Queue for manual filing if AI can't determine
        if (options.enableOfflineQueue) {
          await queueForOffline(file, aiResult);
          return { success: true };
        }
        return { success: false, error: 'Unable to determine filing location' };
      }

      // Upload to determined location
      const uploadResult = await ImageUploadService.uploadImage(
        aiResult.filingDecision.vehicleId,
        file,
        aiResult.filingDecision.category
      );

      if (uploadResult.success) {
        // Update context for next capture
        updateContext(aiResult.filingDecision);
        
        return {
          success: true,
          imageId: uploadResult.imageId,
          vehicleId: aiResult.filingDecision.vehicleId,
          category: aiResult.filingDecision.category
        };
      }

      return { success: false, error: uploadResult.error };

    } catch (error) {
      console.error('Process image error:', error);
      return { success: false, error: 'Processing failed' };
    }
  };

  /**
   * Process batch of images
   */
  const processBatch = async (): Promise<CaptureResult[]> => {
    if (processingRef.current || captureQueue.current.length === 0) {
      return [];
    }

    processingRef.current = true;
    const batch = captureQueue.current.splice(0, options.maxBatchSize || 5);
    const results: CaptureResult[] = [];

    setState(prev => ({ 
      ...prev, 
      processingProgress: 0,
      queuedCount: captureQueue.current.length 
    }));

    try {
      for (let i = 0; i < batch.length; i++) {
        const result = await processImage(batch[i]);
        results.push(result);
        
        // Update progress
        setState(prev => ({ 
          ...prev, 
          processingProgress: ((i + 1) / batch.length) * 100 
        }));
      }
    } finally {
      processingRef.current = false;
      setState(prev => ({ ...prev, processingProgress: undefined }));
    }

    return results;
  };

  /**
   * Queue image for offline processing
   */
  const queueForOffline = async (file: File, aiResult: any) => {
    const queueKey = `offlineQueue_${user?.id}`;
    const queue = JSON.parse(localStorage.getItem(queueKey) || '[]');
    
    // Convert file to base64 for storage
    const reader = new FileReader();
    const base64 = await new Promise<string>((resolve) => {
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(file);
    });

    queue.push({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      fileName: file.name,
      fileSize: file.size,
      base64Data: base64,
      aiResult: aiResult,
      context: contextRef.current
    });

    localStorage.setItem(queueKey, JSON.stringify(queue));
    setState(prev => ({ ...prev, queuedCount: queue.length }));
  };

  /**
   * Update context after successful processing
   */
  const updateContext = (filingDecision: any) => {
    if (!user || !contextRef.current) return;

    // Update recent activity
    if (filingDecision.vehicleId) {
      localStorage.setItem(`lastVehicle_${user.id}`, filingDecision.vehicleId);
      contextRef.current.recentActivity!.lastVehicleId = filingDecision.vehicleId;
    }

    if (filingDecision.category) {
      localStorage.setItem(`lastCategory_${user.id}`, filingDecision.category);
      contextRef.current.recentActivity!.lastCategory = filingDecision.category;
    }
  };

  /**
   * Process offline queue when online
   */
  const processOfflineQueue = useCallback(async () => {
    if (!user) return;

    const queueKey = `offlineQueue_${user.id}`;
    const queue = JSON.parse(localStorage.getItem(queueKey) || '[]');
    
    if (queue.length === 0) return;

    setState(prev => ({ ...prev, isCapturing: true }));

    try {
      const processed: string[] = [];

      for (const item of queue) {
        try {
          // Convert base64 back to file
          const response = await fetch(item.base64Data);
          const blob = await response.blob();
          const file = new File([blob], item.fileName, { type: blob.type });

          // Re-process with current context
          const result = await processImage(file);
          
          if (result.success) {
            processed.push(item.id);
          }
        } catch (error) {
          console.error('Failed to process queued item:', item.id, error);
        }
      }

      // Remove processed items from queue
      const remainingQueue = queue.filter((item: any) => !processed.includes(item.id));
      localStorage.setItem(queueKey, JSON.stringify(remainingQueue));
      setState(prev => ({ ...prev, queuedCount: remainingQueue.length }));

    } finally {
      setState(prev => ({ ...prev, isCapturing: false }));
    }
  }, [user]);

  /**
   * Clear capture session
   */
  const clearSession = useCallback(() => {
    setState({
      isCapturing: false,
      captureCount: 0,
      queuedCount: 0
    });
    captureQueue.current = [];
  }, []);

  // Process offline queue when coming online
  useEffect(() => {
    const handleOnline = () => {
      if (state.queuedCount > 0) {
        processOfflineQueue();
      }
    };

    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [state.queuedCount, processOfflineQueue]);

  return {
    state,
    captureImages,
    processBatch,
    processOfflineQueue,
    clearSession
  };
};