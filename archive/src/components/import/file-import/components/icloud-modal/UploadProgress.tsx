
import React from 'react';

interface UploadProgressProps {
  isUploading: boolean;
  uploadProgress: number;
}

export const UploadProgress: React.FC<UploadProgressProps> = ({ isUploading, uploadProgress }) => {
  if (!isUploading) return null;

  return (
    <div className="space-y-2">
      <div className="flex justify-between text-sm">
        <span>Uploading images...</span>
        <span>{uploadProgress}%</span>
      </div>
      <div className="w-full bg-slate-200 rounded-full h-2.5 dark:bg-slate-700">
        <div 
          className="bg-primary h-2.5 rounded-full" 
          style={{ width: `${uploadProgress}%` }}
        ></div>
      </div>
    </div>
  );
};
