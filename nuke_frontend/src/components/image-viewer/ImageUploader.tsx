/**
 * ImageUploader Component
 * 
 * CONSOLIDATED: Now uses ImageUploadService for consistent EXIF handling,
 * timeline event creation, and multi-resolution variant generation.
 */
import React, { useState } from 'react';
import { ImageUploadService } from '../../services/imageUploadService';

interface ImageUploaderProps {
  vehicleId: string;
  hasExistingImages: boolean;
  uploadProgress: {
    total: number;
    completed: number;
    uploading: boolean;
  };
  onUploadComplete: () => void;
  onUploadProgress: (progress: { total: number; completed: number; uploading: boolean }) => void;
}

export const ImageUploader: React.FC<ImageUploaderProps> = ({
  vehicleId,
  hasExistingImages,
  uploadProgress,
  onUploadComplete,
  onUploadProgress
}) => {
  const [errors, setErrors] = useState<string[]>([]);

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const fileArray = Array.from(files);
    console.log('Files selected:', fileArray.length);

    onUploadProgress({ total: fileArray.length, completed: 0, uploading: true });
    setErrors([]);

    try {
      for (let i = 0; i < fileArray.length; i++) {
        const file = fileArray[i];
        
        // Use the consolidated ImageUploadService which handles:
        // - EXIF extraction (date, GPS, camera)
        // - Multi-resolution variant generation (thumbnail, medium, large)
        // - Storage upload (original + variants)
        // - Database insertion with taken_at date
        // - Timeline event creation with EXIF date
        // - User contribution logging
        const result = await ImageUploadService.uploadImage(
          vehicleId,
          file,
          'general'
        );

        if (!result.success) {
          console.error(`Upload failed for ${file.name}:`, result.error);
          setErrors(prev => [...prev, `${file.name}: ${result.error}`]);
        } else {
          console.log(`Successfully uploaded: ${file.name} (ID: ${result.imageId})`);
        }

        onUploadProgress(prev => ({ ...prev, completed: i + 1 }));
      }

      // Trigger refresh
      onUploadComplete();
    } catch (error) {
      console.error('Upload failed:', error);
      setErrors(prev => [...prev, `Unexpected error: ${error instanceof Error ? error.message : 'Unknown error'}`]);
    } finally {
      onUploadProgress({ total: 0, completed: 0, uploading: false });
    }
  };

  return (
    <div>
      <div className="relative group" style={{
        aspectRatio: '4/3',
        borderRadius: 'var(--radius)',
        backgroundColor: '#f8f9fa',
        border: '2px dashed #dee2e6',
        overflow: 'hidden'
      }}>
        <input
          type="file"
          multiple
          accept="image/*"
          onChange={(e) => handleFileUpload(e.target.files)}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
        />

        {uploadProgress.uploading ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center mb-3">
              <div className="text-blue-600 font-semibold">
                {uploadProgress.total > 0 ? Math.round((uploadProgress.completed / uploadProgress.total) * 100) : 0}%
              </div>
            </div>
            <div className="text-sm font-medium text-gray-700">
              Uploading {uploadProgress.completed} of {uploadProgress.total} files...
            </div>
            <div className="w-32 h-2 bg-gray-200 rounded-full mt-2 overflow-hidden">
              <div
                className="h-full bg-blue-600 transition-all duration-300"
                style={{
                  width: uploadProgress.total > 0
                    ? `${(uploadProgress.completed / uploadProgress.total) * 100}%`
                    : '0%'
                }}
              />
            </div>
          </div>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500 group-hover:text-gray-700 transition-colors">
            <div className="w-12 h-12 rounded-full bg-white border-2 border-gray-300 flex items-center justify-center mb-2 group-hover:border-gray-400 transition-colors">
              <span className="text-xl font-light">+</span>
            </div>
            <div className="text-sm font-medium">Drop files here</div>
            <div className="text-xs text-gray-400">or click to browse</div>
          </div>
        )}
      </div>

      {/* Error Display */}
      {errors.length > 0 && (
        <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
          <div className="font-semibold mb-1">Upload errors:</div>
          {errors.map((error, idx) => (
            <div key={idx}>• {error}</div>
          ))}
        </div>
      )}
    </div>
  );
};