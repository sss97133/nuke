import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

// Image hash generation for duplicate detection
async function generateImageHash(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const buffer = e.target?.result as ArrayBuffer;
      const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      resolve(hashHex.substring(0, 32)); // Use first 32 chars for efficiency
    };
    reader.readAsArrayBuffer(file);
  });
}

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
  const [currentUser, setCurrentUser] = useState<any>(null);

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setCurrentUser(user);
    };
    getUser();
  }, []);
  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const fileArray = Array.from(files);
    console.log('Files selected:', fileArray.length);

    onUploadProgress({ total: fileArray.length, completed: 0, uploading: true });

    try {
      // Import services
      const { supabase } = await import('../../lib/supabase');

      for (let i = 0; i < fileArray.length; i++) {
        const file = fileArray[i];
        const fileName = `${Date.now()}_${i}_${file.name}`;
        const filePath = `vehicles/${vehicleId}/images/${fileName}`;

        // Upload to storage
        const { error: uploadError } = await supabase.storage
          .from('vehicle-data')
          .upload(filePath, file);

        if (!uploadError) {
          // Get public URL
          const { data: urlData } = supabase.storage
            .from('vehicle-data')
            .getPublicUrl(filePath);

          // Generate image hash for duplicate detection
          const imageHash = await generateImageHash(file);

          // Check for duplicate using direct Supabase (faster)
          const { data: existingImages, error: searchError } = await supabase
            .from('vehicle_images')
            .select('id, url, alt_text, inserted_at, uploaded_by')
            .eq('vehicle_id', vehicleId)
            .contains('metadata', { image_hash: imageHash });

          if (!searchError && existingImages && existingImages.length > 0) {
            // Duplicate found - update the duplicate tracking
            console.log('Duplicate image detected, updating metrics...');
            const firstImage = existingImages[0];

            // Update the original image with duplicate tracking
            const currentMetadata = firstImage.metadata || {};
            const duplicates = currentMetadata.duplicate_uploads || [];
            duplicates.push({
              uploaded_at: new Date().toISOString(),
              uploaded_by: currentUser?.id || 'anonymous',
              filename: file.name,
              file_size: file.size
            });

            await supabase
              .from('vehicle_images')
              .update({
                metadata: {
                  ...currentMetadata,
                  duplicate_uploads: duplicates,
                  total_upload_attempts: duplicates.length
                }
              })
              .eq('id', firstImage.id);

            console.log(`Duplicate image blocked. Original uploaded: ${firstImage.inserted_at}. Total attempts: ${duplicates.length}`);

            // Show user notification
            alert(`Duplicate image detected: "${file.name}"\nOriginal uploaded: ${new Date(firstImage.inserted_at).toLocaleDateString()}\nTotal upload attempts: ${duplicates.length}`);
            continue; // Skip this file, move to next
          }

          // No duplicate - proceed with upload using corrected Supabase fields
          const { data: imageData, error: insertError } = await supabase
            .from('vehicle_images')
            .insert({
              vehicle_id: vehicleId,
              url: urlData.publicUrl,
              file_type: file.type,
              file_size: file.size,
              category: 'general',
              is_primary: i === 0 && !hasExistingImages,
              alt_text: file.name,
              metadata: {
                original_filename: file.name,
                storage_path: filePath,
                image_hash: imageHash,
                upload_timestamp: new Date().toISOString(),
                duplicate_uploads: [],
                total_upload_attempts: 1
              }
            })
            .select()
            .single();

          // Create timeline event
          if (!insertError && imageData) {
            const { timelineAPI } = await import('../../services/api');
            try {
              await timelineAPI.createTimelineEvent(vehicleId, {
                event_type: 'image_upload',
                title: `Photo uploaded: ${file.name}`,
                description: `New photo added to vehicle gallery`,
                event_date: new Date().toISOString(),
                metadata: {
                  image_id: imageData.id,
                  image_url: urlData.publicUrl,
                  filename: file.name,
                  file_size: file.size,
                  image_hash: imageHash,
                  auto_generated: true
                }
              });
              console.log('Photo upload successful:', imageData.id);
            } catch (timelineError) {
              console.error('Timeline event creation failed:', timelineError);
            }
          } else if (insertError) {
            console.error('Image insert failed:', insertError);
          }
        }

        onUploadProgress(prev => ({ ...prev, completed: i + 1 }));
      }

      // Trigger refresh
      onUploadComplete();
    } catch (error) {
      console.error('Upload failed:', error);
    } finally {
      onUploadProgress({ total: 0, completed: 0, uploading: false });
    }
  };

  return (
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
  );
};