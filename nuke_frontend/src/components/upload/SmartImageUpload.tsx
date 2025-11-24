import React, { useState, useRef } from 'react';
import { UploadQualityFilter } from './UploadQualityFilter';
import { UploadProgressNotifications } from './UploadProgressNotifications';
import { TitleValidationModal } from './TitleValidationModal';
import { ImageUploadService } from '../../services/imageUploadService';

interface SmartImageUploadProps {
  vehicleId: string;
  onComplete?: () => void;
}

export function SmartImageUpload({ vehicleId, onComplete }: SmartImageUploadProps) {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [showFilter, setShowFilter] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });
  const [titleData, setTitleData] = useState<any>(null);
  const [showTitleModal, setShowTitleModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setSelectedFiles(files);
    setShowFilter(true);
  };

  const handleFilterApprove = async (approvedFiles: File[]) => {
    setShowFilter(false);
    setUploading(true);
    setUploadProgress({ current: 0, total: approvedFiles.length });

    try {
      for (let i = 0; i < approvedFiles.length; i++) {
        const file = approvedFiles[i];
        
        const result = await ImageUploadService.uploadImage(
          vehicleId,
          file,
          'general'
        );

        if (!result.success) {
          console.error(`Upload failed for ${file.name}:`, result.error);
        }

        setUploadProgress({ current: i + 1, total: approvedFiles.length });
      }

      setUploading(false);
      setUploadProgress({ current: 0, total: 0 });
      onComplete?.();

    } catch (error) {
      console.error('Upload error:', error);
      setUploading(false);
    }
  };

  const handleTitleDetected = (data: any) => {
    setTitleData(data);
    setShowTitleModal(true);
  };

  const handleTitleApplied = (updates: any) => {
    console.log('Applied title data:', updates);
    setShowTitleModal(false);
    setTitleData(null);
  };

  const handleValidationNeeded = (conflicts: any[]) => {
    console.log('Validation conflicts:', conflicts);
  };

  return (
    <div>
      {/* Upload Button */}
      <div className="mb-4">
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
        >
          {uploading ? 'Uploading...' : 'Upload Images'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*"
          onChange={handleFileSelect}
          className="hidden"
        />
      </div>

      {/* Upload Progress */}
      {uploading && uploadProgress.total > 0 && (
        <div className="mb-4 p-4 border-2 border-blue-300 bg-blue-50 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <span className="font-medium">Uploading images...</span>
            <span className="text-sm text-gray-600">
              {uploadProgress.current}/{uploadProgress.total}
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-3">
            <div
              className="bg-blue-600 h-3 rounded-full transition-all duration-300"
              style={{ width: `${(uploadProgress.current / uploadProgress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Real-time Notifications */}
      <UploadProgressNotifications
        vehicleId={vehicleId}
        onTitleDetected={handleTitleDetected}
        onValidationNeeded={handleValidationNeeded}
      />

      {/* Quality Filter Modal */}
      {showFilter && (
        <UploadQualityFilter
          files={selectedFiles}
          onApprove={handleFilterApprove}
          onCancel={() => {
            setShowFilter(false);
            setSelectedFiles([]);
          }}
        />
      )}

      {/* Title Validation Modal */}
      {showTitleModal && titleData && (
        <TitleValidationModal
          vehicleId={vehicleId}
          titleData={titleData}
          onClose={() => {
            setShowTitleModal(false);
            setTitleData(null);
          }}
          onApply={handleTitleApplied}
        />
      )}
    </div>
  );
}

