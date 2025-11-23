/**
 * Upload Status Context
 * Provides upload and processing status to all components
 */

import React, { createContext, useContext, useEffect, useState } from 'react';
import { globalUploadStatusService, UploadJob, ProcessingJob } from '../services/globalUploadStatusService';

interface UploadStatusContextValue {
  uploadJobs: UploadJob[];
  processingJobs: ProcessingJob[];
  activeUploadJobs: UploadJob[];
  activeProcessingJobs: ProcessingJob[];
  hasActiveUploads: boolean;
  hasActiveProcessing: boolean;
}

const UploadStatusContext = createContext<UploadStatusContextValue | undefined>(undefined);

export const UploadStatusProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [uploadJobs, setUploadJobs] = useState<UploadJob[]>([]);
  const [processingJobs, setProcessingJobs] = useState<ProcessingJob[]>([]);

  useEffect(() => {
    // Subscribe to status changes
    const unsubscribe = globalUploadStatusService.subscribe((uploads, processing) => {
      setUploadJobs(uploads);
      setProcessingJobs(processing);
    });

    return unsubscribe;
  }, []);

  const activeUploadJobs = uploadJobs.filter(job => job.status === 'uploading');
  const activeProcessingJobs = processingJobs.filter(job => job.status === 'processing');
  const hasActiveUploads = activeUploadJobs.length > 0;
  const hasActiveProcessing = activeProcessingJobs.length > 0;

  return (
    <UploadStatusContext.Provider value={{ 
      uploadJobs, 
      processingJobs, 
      activeUploadJobs, 
      activeProcessingJobs,
      hasActiveUploads,
      hasActiveProcessing
    }}>
      {children}
    </UploadStatusContext.Provider>
  );
};

export const useUploadStatus = () => {
  const context = useContext(UploadStatusContext);
  if (context === undefined) {
    throw new Error('useUploadStatus must be used within UploadStatusProvider');
  }
  return context;
};

