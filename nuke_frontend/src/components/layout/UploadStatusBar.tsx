/**
 * Upload Status Bar
 * Displays in the header during uploads and AI processing
 * Shows real progress with time estimation
 */

import React, { useEffect, useState } from 'react';
import { useUploadStatus } from '../../contexts/UploadStatusContext';
import { globalUploadStatusService } from '../../services/globalUploadStatusService';

export const UploadStatusBar: React.FC = () => {
  const { activeUploadJobs, activeProcessingJobs } = useUploadStatus();
  const [uploadTimes, setUploadTimes] = useState<Map<string, number>>(new Map());
  const [processingTimes, setProcessingTimes] = useState<Map<string, number>>(new Map());

  // Update estimated times every second
  useEffect(() => {
    if (activeUploadJobs.length === 0 && activeProcessingJobs.length === 0) return;

    const interval = setInterval(() => {
      // Upload times
      const newUploadTimes = new Map<string, number>();
      activeUploadJobs.forEach(job => {
        const time = globalUploadStatusService.getEstimatedTimeRemaining(job.id);
        if (time !== null) {
          newUploadTimes.set(job.id, time);
        }
      });
      setUploadTimes(newUploadTimes);

      // Processing times
      const newProcessingTimes = new Map<string, number>();
      activeProcessingJobs.forEach(job => {
        const time = globalUploadStatusService.getEstimatedProcessingTime(job.id);
        if (time !== null) {
          newProcessingTimes.set(job.id, time);
        }
      });
      setProcessingTimes(newProcessingTimes);
    }, 1000);

    return () => clearInterval(interval);
  }, [activeUploadJobs, activeProcessingJobs]);

  // Show nothing if no active jobs
  if (activeUploadJobs.length === 0 && activeProcessingJobs.length === 0) {
    return null;
  }

  // Calculate upload progress
  const totalFiles = activeUploadJobs.reduce((sum, job) => sum + job.totalFiles, 0);
  const completedFiles = activeUploadJobs.reduce((sum, job) => sum + job.completedFiles, 0);
  const uploadProgress = totalFiles > 0 ? (completedFiles / totalFiles) * 100 : 0;

  // Calculate processing progress
  const totalImages = activeProcessingJobs.reduce((sum, job) => sum + job.totalImages, 0);
  const processedImages = activeProcessingJobs.reduce((sum, job) => sum + job.processedImages, 0);
  const processingProgress = totalImages > 0 ? (processedImages / totalImages) * 100 : 0;

  // Get estimated time for upload
  let uploadDisplayTime = '';
  if (activeUploadJobs.length > 0 && uploadTimes.size > 0) {
    const times = Array.from(uploadTimes.values());
    const avgTime = Math.ceil(times.reduce((sum, t) => sum + t, 0) / times.length);
    if (avgTime > 0) {
      uploadDisplayTime = ` - ${globalUploadStatusService.formatTime(avgTime)}`;
    }
  }

  // Get estimated time for processing
  let processingDisplayTime = '';
  if (activeProcessingJobs.length > 0 && processingTimes.size > 0) {
    const times = Array.from(processingTimes.values());
    const avgTime = Math.ceil(times.reduce((sum, t) => sum + t, 0) / times.length);
    if (avgTime > 0) {
      processingDisplayTime = ` - ${globalUploadStatusService.formatTime(avgTime)}`;
    }
  }

  return (
    <>
      {/* Upload Status Bar */}
      {activeUploadJobs.length > 0 && (
        <div
          style={{
            position: 'fixed',
            top: '88px', // Below app header (48px) + vehicle header (40px)
            left: 0,
            right: 0,
            height: '32px',
            backgroundColor: 'var(--grey-100)',
            borderBottom: '2px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            padding: '0 var(--space-4)',
            zIndex: 99,
            fontSize: '8pt',
            fontWeight: 700,
            gap: 'var(--space-3)'
          }}
        >
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <span>Uploading {completedFiles} of {totalFiles} images{uploadDisplayTime}</span>
          </div>
          
          <div
            style={{
              width: '200px',
              height: '8px',
              backgroundColor: 'var(--white)',
              border: '1px inset var(--border-medium)',
              position: 'relative'
            }}
          >
            <div
              style={{
                width: `${uploadProgress}%`,
                height: '100%',
                backgroundColor: 'var(--grey-600)',
                transition: 'width 0.3s ease'
              }}
            />
          </div>

          <span style={{ minWidth: '50px', textAlign: 'right' }}>
            {Math.round(uploadProgress)}%
          </span>
        </div>
      )}

      {/* AI Processing Status Bar */}
      {activeProcessingJobs.length > 0 && (
        <div
          style={{
            position: 'fixed',
            top: activeUploadJobs.length > 0 ? '120px' : '88px', // Stack below upload bar or vehicle header
            left: 0,
            right: 0,
            height: '32px',
            backgroundColor: 'var(--blue-100)',
            borderBottom: '2px solid var(--blue-300)',
            display: 'flex',
            alignItems: 'center',
            padding: '0 var(--space-4)',
            zIndex: 97,
            fontSize: '8pt',
            fontWeight: 700,
            gap: 'var(--space-3)'
          }}
        >
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <span>AI Processing {processedImages} of {totalImages} images{processingDisplayTime}</span>
          </div>
          
          <div
            style={{
              width: '200px',
              height: '8px',
              backgroundColor: 'var(--white)',
              border: '1px inset var(--border-medium)',
              position: 'relative'
            }}
          >
            <div
              style={{
                width: `${processingProgress}%`,
                height: '100%',
                backgroundColor: 'var(--blue-600)',
                transition: 'width 0.3s ease'
              }}
            />
          </div>

          <span style={{ minWidth: '50px', textAlign: 'right' }}>
            {Math.round(processingProgress)}%
          </span>
        </div>
      )}
    </>
  );
};

