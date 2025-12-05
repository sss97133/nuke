import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

interface UploadFile {
  id: string;
  file: File;
  status: 'pending' | 'uploading' | 'success' | 'error';
  progress: number;
  error?: string;
  url?: string;
  vehicleId: string;
}

interface GlobalUploadStatusProps {
  className?: string;
}

// Access the same UploadManager from PersistentImageUpload
declare global {
  interface Window {
    UploadManager?: any;
  }
}

const GlobalUploadStatus: React.FC<GlobalUploadStatusProps> = ({ className = '' }) => {
  const [allUploads, setAllUploads] = useState<Map<string, UploadFile[]>>(new Map());
  const [isExpanded, setIsExpanded] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    // Get the UploadManager instance (it's a singleton)
    const getUploadManager = () => {
      // Import the class dynamically to access the singleton
      // PersistentImageUpload was removed - use UniversalImageUpload events instead
      console.log('PersistentImageUpload removed - GlobalUploadStatus needs update');
    };

    // For now, let's create a simple global event system
    const handleGlobalUploadUpdate = (event: CustomEvent) => {
      const { vehicleId, files } = event.detail;
      setAllUploads(prev => {
        const newMap = new Map(prev);
        if (files && files.length > 0) {
          newMap.set(vehicleId, files);
        } else {
          newMap.delete(vehicleId);
        }
        return newMap;
      });
    };

    // Listen for global upload updates
    window.addEventListener('global_upload_update' as any, handleGlobalUploadUpdate);

    return () => {
      window.removeEventListener('global_upload_update' as any, handleGlobalUploadUpdate);
    };
  }, []);

  // Calculate totals across all vehicles
  const allFiles = Array.from(allUploads.values()).flat();
  const totalFiles = allFiles.length;
  const completedFiles = allFiles.filter(f => f.status === 'success').length;
  const failedFiles = allFiles.filter(f => f.status === 'error').length;
  const uploadingFiles = allFiles.filter(f => f.status === 'uploading' || f.status === 'pending').length;
  const overallProgress = totalFiles > 0 ? Math.round((completedFiles / totalFiles) * 100) : 0;

  // Add/remove body class based on upload status
  useEffect(() => {
    if (totalFiles > 0) {
      document.body.classList.add('has-upload-status');
    } else {
      document.body.classList.remove('has-upload-status');
    }
    
    // Cleanup on unmount
    return () => {
      document.body.classList.remove('has-upload-status');
    };
  }, [totalFiles]);

  // Don't show if no uploads
  if (totalFiles === 0) {
    return null;
  }

  const isUploading = uploadingFiles > 0;

  return (
    <div className={`fixed top-0 left-0 right-0 z-50 bg-white border-b shadow-sm global-upload-status ${className}`}>
      {/* Compact Progress Bar */}
      <div 
        className={`px-4 py-2 cursor-pointer transition-all ${
          isUploading ? 'bg-blue-50' : completedFiles > 0 ? 'bg-green-50' : 'bg-red-50'
        }`}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {isUploading && (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
            )}
            <span className={`text-sm font-medium ${
              isUploading ? 'text-blue-700' : completedFiles > 0 ? 'text-green-700' : 'text-red-700'
            }`}>
              {isUploading ? (
                `Uploading ${completedFiles}/${totalFiles} images...`
              ) : completedFiles === totalFiles ? (
                `✓ All ${totalFiles} images uploaded successfully`
              ) : (
                `${completedFiles}/${totalFiles} uploaded, ${failedFiles} failed`
              )}
            </span>
            <span className={`text-xs ${
              isUploading ? 'text-blue-600' : completedFiles > 0 ? 'text-green-600' : 'text-red-600'
            }`}>
              {overallProgress}%
            </span>
          </div>
          
          <div className="flex items-center gap-2">
            {/* Vehicle count indicator */}
            <span className="text-xs text-gray-500">
              {allUploads.size} vehicle{allUploads.size !== 1 ? 's' : ''}
            </span>
            
            {/* Expand/collapse button */}
            <button className="text-gray-400 hover:text-gray-600">
              <svg 
                className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} 
                fill="none" 
                stroke="currentColor" 
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>
        </div>
        
        {/* Progress bar */}
        <div className="global-upload-progress mt-2">
          <div 
            className={`global-upload-progress-bar ${
              isUploading ? 'uploading' : completedFiles > 0 ? 'completed' : 'error'
            }`}
            style={{ width: `${overallProgress}%` }}
          />
        </div>
      </div>

      {/* Expanded Details */}
      {isExpanded && (
        <div className="border-t bg-gray-50 max-h-64 overflow-y-auto">
          {Array.from(allUploads.entries()).map(([vehicleId, files]) => {
            const vehicleCompleted = files.filter(f => f.status === 'success').length;
            const vehicleUploading = files.filter(f => f.status === 'uploading' || f.status === 'pending').length;
            const vehicleProgress = files.length > 0 ? Math.round((vehicleCompleted / files.length) * 100) : 0;

            return (
              <div key={vehicleId} className="px-4 py-3 border-b border-gray-200 last:border-b-0">
                <div className="flex items-center justify-between mb-2">
                  <button
                    onClick={() => navigate(`/vehicle/${vehicleId}`)}
                    className="text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline"
                  >
                    Vehicle {vehicleId.slice(0, 8)}...
                  </button>
                  <span className="text-xs text-gray-500">
                    {vehicleCompleted}/{files.length} completed ({vehicleProgress}%)
                  </span>
                </div>
                
                {/* Vehicle progress bar */}
                <div className="w-full bg-gray-200 rounded-full h-1 mb-2">
                  <div 
                    className={`h-1 rounded-full transition-all duration-300 ${
                      vehicleUploading > 0 ? 'bg-blue-600' : vehicleCompleted > 0 ? 'bg-green-600' : 'bg-red-600'
                    }`}
                    style={{ width: `${vehicleProgress}%` }}
                  />
                </div>

                {/* File list (show first few) */}
                <div className="space-y-1">
                  {files.slice(0, 3).map(file => (
                    <div key={file.id} className="flex items-center justify-between text-xs">
                      <span className="truncate flex-1 mr-2 text-gray-600">
                        {file.file.name}
                      </span>
                      <div className="flex items-center gap-1">
                        {file.status === 'pending' && (
                          <span className="text-gray-500">Waiting...</span>
                        )}
                        {file.status === 'uploading' && (
                          <span className="text-blue-600">Uploading {file.progress}%</span>
                        )}
                        {file.status === 'success' && (
                          <span className="text-green-600">✓</span>
                        )}
                        {file.status === 'error' && (
                          <span className="text-red-600" title={file.error}>✗</span>
                        )}
                      </div>
                    </div>
                  ))}
                  {files.length > 3 && (
                    <div className="text-xs text-gray-500 text-center">
                      ... and {files.length - 3} more files
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          
          {/* Action buttons */}
          <div className="px-4 py-3 bg-gray-100 flex gap-2">
            {failedFiles > 0 && (
              <button
                onClick={() => {
                  // Trigger retry for all failed uploads
                  window.dispatchEvent(new CustomEvent('retry_all_failed_uploads'));
                }}
                className="px-3 py-1 bg-yellow-600 text-white text-sm rounded hover:bg-yellow-700"
              >
                Retry All Failed ({failedFiles})
              </button>
            )}
            {completedFiles > 0 && !isUploading && (
              <button
                onClick={() => {
                  // Clear all completed uploads
                  window.dispatchEvent(new CustomEvent('clear_all_completed_uploads'));
                }}
                className="px-3 py-1 bg-gray-600 text-white text-sm rounded hover:bg-gray-700"
              >
                Clear Completed
              </button>
            )}
            <button
              onClick={() => setIsExpanded(false)}
              className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
            >
              Minimize
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default GlobalUploadStatus;
