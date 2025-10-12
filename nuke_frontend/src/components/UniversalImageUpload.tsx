/**
 * Universal Image Upload Component
 *
 * THE ONLY image upload component that should be used throughout the app.
 * Uses the proven ImageUploadService.ts pipeline that properly stores data
 * in the database with correct RLS policies and timeline integration.
 *
 * Replaces ALL other image upload components to eliminate confusion and data corruption.
 */

import React, { useState, useRef, useCallback } from 'react';
import { ImageUploadService, type ImageUploadResult } from '../services/imageUploadService';

interface UniversalImageUploadProps {
  vehicleId: string;
  variant?: 'single' | 'bulk' | 'quick' | 'detailed';
  category?: 'exterior' | 'interior' | 'engine' | 'damage' | 'repair' | 'restoration' | 'document' | 'general';
  onUploadSuccess?: (results: ImageUploadResult[]) => void;
  onUploadStart?: () => void;
  onUploadError?: (error: string) => void;
  maxFiles?: number;
  className?: string;
  disabled?: boolean;
  showPreview?: boolean;
  autoUpload?: boolean;
}

interface UploadFile {
  id: string;
  file: File;
  preview: string;
  status: 'pending' | 'uploading' | 'success' | 'error';
  progress: number;
  error?: string;
  result?: ImageUploadResult;
}

const UniversalImageUpload: React.FC<UniversalImageUploadProps> = ({
  vehicleId,
  variant = 'single',
  category = 'general',
  onUploadSuccess,
  onUploadStart,
  onUploadError,
  maxFiles = variant === 'single' ? 1 : 10,
  className = '',
  disabled = false,
  showPreview = true,
  autoUpload = true
}) => {
  const [uploadFiles, setUploadFiles] = useState<UploadFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);


  // Handle file selection
  const handleFileSelect = useCallback(async (files: FileList) => {
    console.log('handleFileSelect called with', files.length, 'files');
    if (!files || files.length === 0) return;

    // Convert FileList to array and limit to maxFiles
    const fileArray = Array.from(files).slice(0, maxFiles);

    // Create upload file objects with previews
    const newUploadFiles: UploadFile[] = await Promise.all(
      fileArray.map(async (file) => {
        const preview = await createPreviewUrl(file);
        return {
          id: crypto.randomUUID(),
          file,
          preview,
          status: 'pending' as const,
          progress: 0
        };
      })
    );

    setUploadFiles(prev => {
      const combined = [...prev, ...newUploadFiles];
      return combined.slice(0, maxFiles); // Ensure we don't exceed maxFiles
    });

    // Auto-upload if enabled
    if (autoUpload) {
      uploadNewFiles(newUploadFiles);
    }
  }, [maxFiles, autoUpload]);

  // Create preview URL for file
  const createPreviewUrl = (file: File): Promise<string> => {
    return new Promise((resolve) => {
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      } else {
        // For non-image files (PDFs, etc), return a generic document icon
        resolve('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHZpZXdCb3g9IjAgMCA2NCA2NCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiBmaWxsPSIjRjNGNEY2Ii8+CjxwYXRoIGQ9Ik0yMCAyMEg0NFY0NEgyMFYyMFoiIHN0cm9rZT0iIzY5NzA3QiIgc3Ryb2tlLXdpZHRoPSIyIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiLz4KPHBhdGggZD0iTTI4IDI4SDM2IiBzdHJva2U9IiM2OTcwN0IiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIi8+CjxwYXRoIGQ9Ik0yOCAzMkgzNiIgc3Ryb2tlPSIjNjk3MDdCIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPgo8cGF0aCBkPSJNMjggMzZIMzYiIHN0cm9rZT0iIzY5NzA3QiIgc3Ryb2tlLXdpZHRoPSIyIiBzdHJva2UtbGluZWNhcD0icm91bmQiLz4KPC9zdmc+');
      }
    });
  };

  // Upload files using the proven ImageUploadService
  const uploadNewFiles = useCallback(async (filesToUpload: UploadFile[]) => {
    if (isUploading || filesToUpload.length === 0) return;

    setIsUploading(true);
    onUploadStart?.();

    const results: ImageUploadResult[] = [];

    for (const uploadFile of filesToUpload) {
      // Update status to uploading
      setUploadFiles(prev =>
        prev.map(f => f.id === uploadFile.id ? { ...f, status: 'uploading', progress: 50 } : f)
      );

      try {
        // Use the WORKING ImageUploadService - the only one that properly pipelines to DB
        const result = await ImageUploadService.uploadImage(
          vehicleId,
          uploadFile.file,
          category
        );

        if (result.success) {
          setUploadFiles(prev =>
            prev.map(f => f.id === uploadFile.id ?
              { ...f, status: 'success', progress: 100, result } : f
            )
          );
          results.push(result);
        } else {
          setUploadFiles(prev =>
            prev.map(f => f.id === uploadFile.id ?
              { ...f, status: 'error', progress: 0, error: result.error } : f
            )
          );
          onUploadError?.(result.error || 'Upload failed');
        }
      } catch (error: any) {
        const errorMessage = error.message || 'Upload failed';
        setUploadFiles(prev =>
          prev.map(f => f.id === uploadFile.id ?
            { ...f, status: 'error', progress: 0, error: errorMessage } : f
          )
        );
        onUploadError?.(errorMessage);
      }
    }

    setIsUploading(false);

    if (results.length > 0) {
      onUploadSuccess?.(results);
    }
  }, [vehicleId, category, isUploading, onUploadStart, onUploadSuccess, onUploadError]);

  // Manual upload trigger for non-auto mode
  const handleManualUpload = () => {
    const pendingFiles = uploadFiles.filter(f => f.status === 'pending');
    uploadNewFiles(pendingFiles);
  };

  // Remove file from upload queue
  const removeFile = (fileId: string) => {
    setUploadFiles(prev => prev.filter(f => f.id !== fileId));
  };

  // Clear all files
  const clearAll = () => {
    setUploadFiles([]);
  };

  // File input change handler
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleFileSelect(e.target.files);
    }
  };

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const files = e.dataTransfer.files;
    if (files) {
      handleFileSelect(files);
    }
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  // Render upload area based on variant
  const renderUploadArea = () => {
    switch (variant) {
      case 'quick':
        return (
          <div
            className="text-center p-3 border border-dashed border-gray-300 rounded-lg hover:border-blue-400 transition-colors"
            onDragOver={handleDragOver}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept={category === 'document' ? 'image/*,application/pdf,.pdf,.jpg,.jpeg,.png,.gif,.bmp,.tiff' : 'image/*'}
              multiple={maxFiles > 1}
              onChange={handleInputChange}
              className="hidden"
              disabled={disabled}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled || isUploading}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {isUploading ? 'Uploading...' : '+ Add Photos'}
            </button>
          </div>
        );

      case 'bulk':
        return (
          <div
            className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-400 transition-colors"
            onDragOver={handleDragOver}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept={category === 'document' ? 'image/*,application/pdf,.pdf,.jpg,.jpeg,.png,.gif,.bmp,.tiff' : 'image/*'}
              multiple
              onChange={handleInputChange}
              className="hidden"
              disabled={disabled}
            />
            <div className="space-y-4">
              <div className="text-4xl text-gray-400">📁</div>
              <div>
                <p className="text-lg font-medium text-gray-700">Drop images here or click to browse</p>
                <p className="text-sm text-gray-500">Up to {maxFiles} {category === 'document' ? 'files' : 'images'}, max 10MB each</p>
              </div>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={disabled || isUploading}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                Choose Images
              </button>
            </div>
          </div>
        );

      default:
        return (
          <div className="space-y-4">
            <div
              className="border border-gray-300 rounded-lg p-6 text-center cursor-pointer hover:border-blue-400 transition-colors"
              onDragOver={handleDragOver}
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept={category === 'document' ? 'image/*,application/pdf,.pdf,.jpg,.jpeg,.png,.gif,.bmp,.tiff' : 'image/*'}
                multiple={maxFiles > 1}
                onChange={handleInputChange}
                className="hidden"
                disabled={disabled}
              />
              <div className="space-y-2">
                <div className="text-2xl text-gray-400">📷</div>
                <p className="text-gray-700">Click to upload or drag and drop</p>
                <p className="text-sm text-gray-500">{category === 'document' ? 'Images, PDFs up to 10MB' : 'PNG, JPG up to 10MB'}</p>
              </div>
            </div>
          </div>
        );
    }
  };

  return (
    <div className={`universal-image-upload ${className}`}>
      {/* Upload Area */}
      {renderUploadArea()}

      {/* Manual Upload Button (for non-auto mode) */}
      {!autoUpload && uploadFiles.some(f => f.status === 'pending') && (
        <div className="mt-4 text-center">
          <button
            onClick={handleManualUpload}
            disabled={isUploading}
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
          >
            Upload {uploadFiles.filter(f => f.status === 'pending').length} Image(s)
          </button>
        </div>
      )}

      {/* File Preview List */}
      {showPreview && uploadFiles.length > 0 && (
        <div className="mt-4">
          <div className="flex justify-between items-center mb-2">
            <h4 className="font-medium text-gray-700">
              Images ({uploadFiles.length})
            </h4>
            <button
              onClick={clearAll}
              className="text-sm text-red-600 hover:text-red-800"
              disabled={isUploading}
            >
              Clear All
            </button>
          </div>

          <div className="space-y-2 max-h-60 overflow-y-auto">
            {uploadFiles.map((uploadFile) => (
              <div key={uploadFile.id} className="flex items-center space-x-3 p-2 border rounded">
                {/* Thumbnail */}
                <img
                  src={uploadFile.preview}
                  alt="Preview"
                  className="w-12 h-12 object-cover rounded"
                />

                {/* File Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-700 truncate">
                    {uploadFile.file.name}
                  </p>
                  <p className="text-xs text-gray-500">
                    {(uploadFile.file.size / 1024 / 1024).toFixed(2)} MB
                  </p>

                  {/* Progress/Status */}
                  {uploadFile.status === 'uploading' && (
                    <div className="w-full bg-gray-200 rounded-full h-1 mt-1">
                      <div
                        className="bg-blue-600 h-1 rounded-full transition-all duration-300"
                        style={{ width: `${uploadFile.progress}%` }}
                      />
                    </div>
                  )}

                  {uploadFile.status === 'success' && (
                    <p className="text-xs text-green-600">✓ Uploaded</p>
                  )}

                  {uploadFile.status === 'error' && (
                    <p className="text-xs text-red-600">✗ {uploadFile.error}</p>
                  )}
                </div>

                {/* Remove Button */}
                <button
                  onClick={() => removeFile(uploadFile.id)}
                  disabled={uploadFile.status === 'uploading'}
                  className="text-red-500 hover:text-red-700 disabled:opacity-50"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Upload Status */}
      {isUploading && (
        <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-center">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-2"></div>
            <span className="text-sm text-blue-700">Uploading images...</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default UniversalImageUpload;