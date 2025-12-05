import React, { useState, useEffect } from 'react';
import { uploadManager, type UploadTask } from '../services/uploadManager';
import type { X, Pause, Play, ChevronUp, ChevronDown, CheckCircle, AlertCircle } from 'lucide-react';

export const UploadProgressBar: React.FC = () => {
  const [uploads, setUploads] = useState<UploadTask[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);

  useEffect(() => {
    const unsubscribe = uploadManager.subscribe(setUploads);
    return unsubscribe;
  }, []);

  const activeUploads = uploads.filter(u => 
    u.status === 'uploading' || u.status === 'queued' || u.status === 'paused'
  );
  
  const completedUploads = uploads.filter(u => u.status === 'completed');

  if (uploads.length === 0) return null;

  const overallProgress = uploadManager.getOverallProgress();
  
  // Calculate overall percentage
  const totalFiles = uploads.reduce((sum, u) => sum + u.totalCount, 0);
  const uploadedFiles = uploads.reduce((sum, u) => sum + u.uploadedCount, 0);
  const overallPercent = totalFiles > 0 ? Math.round((uploadedFiles / totalFiles) * 100) : 0;

  return (
    <div 
      className={`fixed bottom-4 right-4 bg-white border border-gray-300 rounded-lg shadow-xl transition-all duration-300 z-50 ${
        isMinimized ? 'w-64' : isExpanded ? 'w-96 max-h-96' : 'w-80'
      }`}
    >
      {/* Header */}
      <div className="p-3 border-b bg-gray-50 rounded-t-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="relative">
              <svg className="w-5 h-5 text-blue-600 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              {overallProgress.active > 0 && (
                <span className="absolute -top-1 -right-1 bg-blue-600 text-white text-xs rounded-full w-3 h-3 flex items-center justify-center">
                  {overallProgress.active}
                </span>
              )}
            </div>
            <span className="font-medium text-sm">
              {overallProgress.active > 0 
                ? `Uploading ${uploadedFiles}/${totalFiles} files`
                : completedUploads.length > 0
                ? 'Uploads complete'
                : 'Uploads paused'
              }
            </span>
          </div>
          <div className="flex items-center space-x-1">
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-1 hover:bg-gray-200 rounded"
            >
              {isExpanded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
            </button>
            <button
              onClick={() => setIsMinimized(!isMinimized)}
              className="p-1 hover:bg-gray-200 rounded"
            >
              <div className="w-3 h-0.5 bg-gray-600" />
            </button>
            <button
              onClick={() => uploadManager.clearCompleted()}
              className="p-1 hover:bg-gray-200 rounded"
            >
              <X size={16} />
            </button>
          </div>
        </div>
        
        {/* Overall Progress Bar */}
        {!isMinimized && overallProgress.active > 0 && (
          <div className="mt-2">
            <div className="bg-gray-200 rounded-full h-1.5">
              <div 
                className="bg-blue-600 h-1.5 rounded-full transition-all duration-300"
                style={{ width: `${overallPercent}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>{overallPercent}%</span>
              <span>{(uploads.reduce((sum, u) => sum + u.uploadedSize, 0) / 1024 / 1024).toFixed(1)} MB uploaded</span>
            </div>
          </div>
        )}
      </div>

      {/* Upload List */}
      {!isMinimized && isExpanded && (
        <div className="max-h-72 overflow-y-auto">
          {uploads.map(upload => (
            <div key={upload.id} className="p-3 border-b hover:bg-gray-50">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center space-x-2 flex-1">
                  {upload.status === 'completed' && <CheckCircle size={16} className="text-green-500" />}
                  {upload.status === 'failed' && <AlertCircle size={16} className="text-red-500" />}
                  {upload.status === 'uploading' && (
                    <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                  )}
                  {upload.status === 'paused' && <Pause size={16} className="text-yellow-500" />}
                  {upload.status === 'queued' && <div className="w-4 h-4 border-2 border-gray-300 rounded-full" />}
                  
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{upload.vehicleName}</div>
                    <div className="text-xs text-gray-500">
                      {upload.uploadedCount}/{upload.totalCount} files • {(upload.uploadedSize / 1024 / 1024).toFixed(1)}MB
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center space-x-1">
                  {upload.status === 'uploading' && (
                    <button
                      onClick={() => uploadManager.pauseUpload(upload.id)}
                      className="p-1 hover:bg-gray-200 rounded"
                    >
                      <Pause size={14} />
                    </button>
                  )}
                  {upload.status === 'paused' && (
                    <button
                      onClick={() => uploadManager.resumeUpload(upload.id)}
                      className="p-1 hover:bg-gray-200 rounded"
                    >
                      <Play size={14} />
                    </button>
                  )}
                  <button
                    onClick={() => uploadManager.cancelUpload(upload.id)}
                    className="p-1 hover:bg-gray-200 rounded"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
              
              {/* Individual Progress Bar */}
              {(upload.status === 'uploading' || upload.status === 'paused') && (
                <div className="mt-2">
                  <div className="bg-gray-200 rounded-full h-1">
                    <div 
                      className={`h-1 rounded-full transition-all duration-300 ${
                        upload.status === 'paused' ? 'bg-yellow-400' : 'bg-blue-600'
                      }`}
                      style={{ width: `${uploadManager.getProgress(upload.id)}%` }}
                    />
                  </div>
                </div>
              )}
              
              {upload.error && (
                <div className="text-xs text-red-500 mt-1">{upload.error}</div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Quick Stats when collapsed */}
      {!isMinimized && !isExpanded && activeUploads.length > 0 && (
        <div className="p-2 text-xs text-gray-600">
          <div className="flex justify-between">
            <span>{overallProgress.active} active</span>
            <span>{overallProgress.queued} queued</span>
            <span>{overallProgress.completed} done</span>
          </div>
        </div>
      )}
    </div>
  );
};
