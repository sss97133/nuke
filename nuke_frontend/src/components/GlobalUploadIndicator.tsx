// Global Upload Progress Indicator
// Shows upload progress in bottom-right corner like Dropbox

import React, { useState, useEffect } from 'react';
import { uploadQueue } from '../services/globalUploadQueue';

const GlobalUploadIndicator: React.FC = () => {
  const [queue, setQueue] = useState<any[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    // Subscribe to upload queue changes
    const unsubscribe = uploadQueue.subscribe((newQueue) => {
      setQueue(newQueue);
    });
    return unsubscribe;
  }, []);

  // Filter active uploads
  const activeUploads = queue.filter(item => 
    item.status === 'pending' || item.status === 'uploading'
  );
  const completedCount = queue.filter(item => item.status === 'completed').length;
  const failedCount = queue.filter(item => item.status === 'failed').length;

  // Hide if no items
  if (queue.length === 0) return null;

  // Calculate overall progress
  const totalProgress = queue.reduce((sum, item) => sum + item.progress, 0);
  const averageProgress = queue.length > 0 ? totalProgress / queue.length : 0;
  
  // Calculate number of filled segments (10 total)
  const filledSegments = Math.floor(averageProgress / 10);

  return (
    <div 
      onClick={() => setIsExpanded(!isExpanded)}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '2px 6px',
        backgroundColor: 'var(--border)',
        border: '2px solid',
        borderColor: 'var(--bg) var(--text-disabled) var(--text-disabled) var(--bg)',
        cursor: 'pointer',
        fontSize: '11px',
        fontFamily: 'monospace',
        userSelect: 'none'
      }}
    >
      {/* Retro icon indicator */}
      <div style={{
        width: '10px',
        height: '10px',
        backgroundColor: activeUploads.length > 0 ? 'var(--success)' : 'var(--text-disabled)',
        border: '1px solid var(--text)',
        animation: activeUploads.length > 0 ? 'blink 1s infinite' : 'none'
      }} />
      
      {/* Segmented progress bar - Windows 95 style */}
      <div style={{
        display: 'flex',
        gap: '1px',
        backgroundColor: 'var(--text)',
        padding: '1px',
        border: '1px solid',
        borderColor: 'var(--text-disabled) var(--bg) var(--bg) var(--text-disabled)'
      }}>
        {[...Array(10)].map((_, i) => (
          <div
            key={i}
            style={{
              width: '8px',
              height: '10px',
              backgroundColor: i < filledSegments ? 'var(--accent)' : 'var(--bg)'
            }}
          />
        ))}
      </div>
      
      {/* Count display */}
      <span style={{ color: 'var(--text)' }}>
        {activeUploads.length > 0 ? `${activeUploads.length}↑` : '✓'}
      </span>

      
      {/* Expanded tooltip on hover */}
      {isExpanded && (
        <div style={{
          position: 'absolute',
          top: '100%',
          right: 0,
          marginTop: '4px',
          width: '300px',
          backgroundColor: 'var(--border)',
          border: '2px solid',
          borderColor: 'var(--bg) var(--text) var(--text) var(--bg)',
          padding: '4px',
          fontSize: '10px',
          fontFamily: 'monospace',
          zIndex: 10001,
          boxShadow: '2px 2px 0px var(--overlay)'
        }}>
          <div style={{ 
            backgroundColor: 'var(--accent)',
            color: 'var(--bg)',
            padding: '2px 4px',
            marginBottom: '2px',
            fontWeight: 'bold'
          }}>
            Upload Queue
          </div>
          <div style={{ 
            backgroundColor: 'var(--bg)',
            border: '1px solid var(--text-disabled)',
            padding: '4px',
            maxHeight: '200px',
            overflowY: 'auto'
          }}>
            {queue.map(item => (
              <div key={item.id} style={{ padding: '2px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>{(item.file?.name || 'Unknown file').substring(0, 25)}...</span>
                  <span>{item.status === 'completed' ? '✓' : 
                         item.status === 'failed' ? 'X' : 
                         `${item.progress}%`}</span>
                </div>
              </div>
            ))}
          </div>
          <div style={{ 
            marginTop: '4px',
            padding: '2px',
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: '9px'
          }}>
            <span>{completedCount} done, {failedCount} failed</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                uploadQueue.clearCompleted();
              }}
              style={{
                backgroundColor: 'var(--border)',
                border: '1px solid',
                borderColor: 'var(--bg) var(--text) var(--text) var(--bg)',
                padding: '1px 4px',
                fontSize: '9px',
                cursor: 'pointer'
              }}
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// Add retro animations (guard for SSR)
if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = `
    @keyframes blink {
      0%, 49% { opacity: 1; }
      50%, 100% { opacity: 0; }
    }
  `;
  document.head.appendChild(style);
}

export default GlobalUploadIndicator;
