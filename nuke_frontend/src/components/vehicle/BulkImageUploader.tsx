/**
 * BulkImageUploader Component
 * 
 * CONSOLIDATED: Now uses ImageUploadService for consistent EXIF handling.
 * Keeps UI features for batch EXIF preview and category inference.
 */
import React, { useState, useCallback, useRef } from 'react';
import type { Upload, X, Image, MapPin, Calendar, Info, Loader2 } from 'lucide-react';
import type { ImageExifService } from '../../services/imageExifServiceStub';
import { ImageUploadService } from '../../services/imageUploadService';
import { processBulkUpload, type BulkUploadResult } from '../../services/duplicateDetectionService';
import { globalUploadStatusService } from '../../services/globalUploadStatusService';
import { supabase } from '../../lib/supabase';
import AutoFixResults from './AutoFixResults';

interface BulkImageUploaderProps {
  vehicleId: string;
  onDataExtracted?: (data: any) => void;
  onImagesUploaded?: (imageUrls: string[]) => void;
}

interface ImagePreview {
  file: File;
  url: string;
  exifData?: any;
  uploading?: boolean;
  uploaded?: boolean;
  error?: string;
  isDuplicate?: boolean;
  duplicateReason?: string;
}

export function BulkImageUploader({ 
  vehicleId, 
  onDataExtracted,
  onImagesUploaded 
}: BulkImageUploaderProps) {
  const [images, setImages] = useState<ImagePreview[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [extractedData, setExtractedData] = useState<any>(null);
  const [duplicateResult, setDuplicateResult] = useState<BulkUploadResult | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [autoFixResults, setAutoFixResults] = useState<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    
    if (files.length > 500) {
      alert('Maximum 500 images at once. Please select fewer files.');
      return;
    }
    
    setIsProcessing(true);
    setStatusMessage(`Processing ${files.length} images...`);
    console.log(`Processing ${files.length} images...`);
    
    try {
      // Step 1: Detect duplicates BEFORE creating previews
      const dupResult = await processBulkUpload(files, vehicleId, (progress, status) => {
        setUploadProgress(progress);
        setStatusMessage(status);
      });
      
      setDuplicateResult(dupResult);
      
      // Step 2: Create preview objects only for unique files
      const duplicateFileNames = new Set(dupResult.duplicates.map(d => d.fileName));
      const uniqueFiles = files.filter(f => !duplicateFileNames.has(f.name));
      
      const newImages: ImagePreview[] = files.map(file => ({
        file,
        url: URL.createObjectURL(file),
        isDuplicate: duplicateFileNames.has(file.name),
        duplicateReason: dupResult.duplicates.find(d => d.fileName === file.name)?.reason
      }));
      
      setImages(prev => [...prev, ...newImages]);
      
      // Show summary
      if (dupResult.rejected > 0) {
        setStatusMessage(
          `✅ ${dupResult.uploaded} unique images ready | ⚠️ ${dupResult.rejected} duplicates rejected`
        );
      } else {
        setStatusMessage(`✅ All ${dupResult.uploaded} images are unique`);
      }
      
      // Extract EXIF data in batches to avoid memory issues
      const batchSize = 50;
      const exifDataMap = new Map();
      
      for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize);
        const batchExif = await ImageExifService.extractBatchExifData(batch);
        batchExif.forEach((data, filename) => {
          exifDataMap.set(filename, data);
        });
      }
      
      // Update images with EXIF data
      setImages(prev => prev.map(img => ({
        ...img,
        exifData: exifDataMap.get(img.file.name)
      })));
      
      // Infer data from EXIF
      const inferredPurchaseDate = ImageExifService.inferPurchaseDate(exifDataMap);
      const inferredLocation = await ImageExifService.inferPurchaseLocation(exifDataMap);
      
      const extracted = {
        purchaseDate: inferredPurchaseDate?.toISOString().split('T')[0],
        purchaseLocation: inferredLocation,
        totalImages: files.length,
        earliestPhotoDate: inferredPurchaseDate,
        imageCategories: categorizeImages(files),
      };
      
      setExtractedData(extracted);
      onDataExtracted?.(extracted);
      
      console.log(`Extracted data from ${files.length} images`);
    } catch (error) {
      console.error('Error processing images:', error);
      console.error('Error processing images');
    } finally {
      setIsProcessing(false);
    }
  }, [onDataExtracted]);
  
  const categorizeImages = (files: File[]) => {
    const categories = {
      exterior: 0,
      interior: 0,
      engine: 0,
      documentation: 0,
      other: 0,
    };
    
    files.forEach(file => {
      const name = file.name.toLowerCase();
      if (name.includes('exterior') || name.includes('outside')) {
        categories.exterior++;
      } else if (name.includes('interior') || name.includes('inside')) {
        categories.interior++;
      } else if (name.includes('engine') || name.includes('motor')) {
        categories.engine++;
      } else if (name.includes('title') || name.includes('document') || name.includes('receipt')) {
        categories.documentation++;
      } else {
        categories.other++;
      }
    });
    
    return categories;
  };
  
  const uploadImages = async () => {
    if (images.length === 0) return;
    
    // Filter out duplicates before uploading
    const uniqueImages = images.filter(img => !img.isDuplicate);
    
    if (uniqueImages.length === 0) {
      alert('No unique images to upload. All selected images are duplicates.');
      return;
    }
    
    // Create global upload job - this allows user to navigate away
    const uploadJobId = globalUploadStatusService.createJob(vehicleId, uniqueImages.length);
    console.log(`Created upload job ${uploadJobId} for ${uniqueImages.length} images`);
    
    setIsProcessing(true);
    setStatusMessage(`🚀 Upload started! You can navigate away - progress will continue in background.`);
    const uploadedUrls: string[] = [];
    const errors: string[] = [];
    
    try {
      // Upload with global progress tracking (no local state updates per image)
      let uploaded = 0;
      let failed = 0;
      
      for (const img of uniqueImages) {
        try {
          // Determine category from filename hints
          const fileName = img.file.name.toLowerCase();
          let category = 'general';
          if (fileName.includes('exterior') || fileName.includes('outside')) {
            category = 'exterior';
          } else if (fileName.includes('interior') || fileName.includes('inside')) {
            category = 'interior';
          } else if (fileName.includes('engine') || fileName.includes('motor')) {
            category = 'engine';
          }
          
          const result = await ImageUploadService.uploadImage(
            vehicleId,
            img.file,
            category
          );
          
          if (result.success && result.imageUrl) {
            uploadedUrls.push(result.imageUrl);
            uploaded++;
          } else {
            errors.push(`${img.file.name}: ${result.error || 'Unknown error'}`);
            failed++;
          }
          
          // Update GLOBAL progress (not local state) - prevents page reloads!
          globalUploadStatusService.updateJobProgress(uploadJobId, uploaded, failed, errors);
          
          // Only update local UI every 10 images to reduce re-renders
          if (uploaded % 10 === 0 || uploaded === uniqueImages.length) {
            setUploadProgress(Math.round(((uploaded + failed) / uniqueImages.length) * 100));
          }
        } catch (error) {
          console.error(`Error uploading ${img.file.name}:`, error);
          errors.push(`${img.file.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
          failed++;
          
          // Update global progress
          globalUploadStatusService.updateJobProgress(uploadJobId, uploaded, failed, errors);
        }
      }
      
      // Final update to global progress
      globalUploadStatusService.updateJobProgress(uploadJobId, uploaded, failed, errors);
      
      if (errors.length > 0) {
        console.warn(`Upload completed with ${errors.length} errors:`, errors);
        setStatusMessage(`⚠️ Uploaded ${uploaded} images. ${failed} failed.`);
      } else {
        setStatusMessage(`✅ All ${uploaded} images uploaded successfully!`);
      }
      
      onImagesUploaded?.(uploadedUrls);
      console.log(`✅ Upload job ${uploadJobId} complete: ${uploaded} uploaded, ${failed} failed`);
      
      // AUTO-FIX: Trigger profile correction after upload
      if (uploaded > 0) {
        setStatusMessage(`🔍 Auto-checking profile data...`);
        try {
          const { data: allImages } = await supabase
            .from('vehicle_images')
            .select('id')
            .eq('vehicle_id', vehicleId)
            .limit(5);
          
          if (allImages && allImages.length > 0) {
            const fixResponse = await supabase.functions.invoke('auto-fix-vehicle-profile', {
              body: {
                vehicle_id: vehicleId,
                image_ids: allImages.map(img => img.id)
              }
            });
            
            const fixResult = fixResponse.data;
            
            if (fixResult.success && fixResult.fixes && fixResult.fixes.length > 0) {
              const corrected = fixResult.fixes.filter((f: any) => f.action === 'corrected');
              const added = fixResult.fixes.filter((f: any) => f.action === 'added');
              
              // Store fix results for display
              setAutoFixResults(fixResult.fixes);
              
              if (corrected.length > 0 || added.length > 0) {
                const fixSummary = [];
                if (corrected.length > 0) fixSummary.push(`${corrected.length} corrected`);
                if (added.length > 0) fixSummary.push(`${added.length} added`);
                
                setStatusMessage(`✅ Upload complete! 🔧 Auto-fixed: ${fixSummary.join(', ')}`);
                
                // Show what was fixed
                console.log('Auto-fix results:', fixResult.fixes);
              } else {
                setStatusMessage(`✅ Upload complete! Profile data verified correct.`);
              }
            } else {
              setStatusMessage(`✅ Upload complete! Profile data looks good.`);
            }
          }
        } catch (autoFixError) {
          console.error('Auto-fix failed:', autoFixError);
          // Don't block on auto-fix failure
        }
      }
      
      // Clear after successful upload (slight delay so user sees completion)
      setTimeout(() => {
        setImages([]);
        setUploadProgress(0);
        setDuplicateResult(null);
        setStatusMessage('');
      }, 2000);
      
    } catch (error) {
      console.error('Error uploading images:', error);
      setStatusMessage('❌ Upload failed: ' + (error instanceof Error ? error.message : 'Unknown error'));
      // Don't remove the job on error - let user see what failed
    } finally {
      setIsProcessing(false);
    }
  };
  
  const removeImage = (index: number) => {
    setImages(prev => prev.filter((_, i) => i !== index));
  };
  
  return (
    <div className="space-y-4">
      {/* Auto-Fix Results */}
      {autoFixResults && autoFixResults.length > 0 && (
        <AutoFixResults 
          fixes={autoFixResults}
          onClose={() => setAutoFixResults(null)}
        />
      )}
      
      {/* Upload Area */}
      <div 
        onClick={() => fileInputRef.current?.click()}
        className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-500 transition-colors cursor-pointer"
      >
        <Upload className="mx-auto h-12 w-12 text-gray-400 mb-4" />
        <p className="text-sm text-gray-600">
          Click to select up to 500 images
        </p>
        <p className="text-xs text-gray-500 mt-2">
          Images will be analyzed for EXIF data to auto-fill purchase date and location
        </p>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*"
          onChange={handleFileSelect}
          className="hidden"
        />
      </div>
      
      {/* Status Message */}
      {statusMessage && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm text-gray-700">
          {statusMessage}
        </div>
      )}
      
      {/* Duplicate Detection Results */}
      {duplicateResult && duplicateResult.rejected > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <h4 className="font-semibold text-yellow-900 mb-2 flex items-center gap-2">
            ⚠️ Duplicate Detection Results
          </h4>
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span>Total Files Selected:</span>
              <span className="font-semibold">{duplicateResult.total}</span>
            </div>
            <div className="flex items-center justify-between text-green-700">
              <span>Unique Images (will upload):</span>
              <span className="font-semibold">{duplicateResult.uploaded}</span>
            </div>
            <div className="flex items-center justify-between text-red-700">
              <span>Duplicates (rejected):</span>
              <span className="font-semibold">{duplicateResult.rejected}</span>
            </div>
            
            {duplicateResult.duplicates.length > 0 && (
              <details className="mt-3">
                <summary className="cursor-pointer text-yellow-900 font-medium">
                  View Rejected Files ({duplicateResult.duplicates.length})
                </summary>
                <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
                  {duplicateResult.duplicates.map((dup, idx) => (
                    <div key={idx} className="text-xs bg-white p-2 rounded border border-yellow-100">
                      <div className="font-medium truncate">{dup.fileName}</div>
                      <div className="text-yellow-700">{dup.reason}</div>
                      {dup.duplicateOf && (
                        <div className="text-gray-500">Duplicate of: {dup.duplicateOf}</div>
                      )}
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        </div>
      )}
      
      {/* Extracted Data Summary */}
      {extractedData && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h4 className="font-semibold text-blue-900 mb-2 flex items-center gap-2">
            <Info className="w-4 h-4" />
            Extracted Data from Images
          </h4>
          <div className="space-y-1 text-sm">
            {extractedData.purchaseDate && (
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-blue-600" />
                <span>Purchase Date: {extractedData.purchaseDate}</span>
              </div>
            )}
            {extractedData.purchaseLocation && (
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-blue-600" />
                <span>Location: {extractedData.purchaseLocation}</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Image className="w-4 h-4 text-blue-600" />
              <span>Total Images: {extractedData.totalImages}</span>
            </div>
          </div>
        </div>
      )}
      
      {/* Image Preview Grid */}
      {images.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="font-semibold">
              {images.length} Images Selected
            </h4>
            {images.length > 0 && (
              <button
                onClick={uploadImages}
                disabled={isProcessing}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Uploading... {uploadProgress}%
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4" />
                    Upload All
                  </>
                )}
              </button>
            )}
          </div>
          
          {/* Show first 20 images as preview */}
          <div className="grid grid-cols-5 gap-2 max-h-96 overflow-y-auto">
            {images.slice(0, 20).map((img, index) => (
              <div key={index} className="relative group">
                <img 
                  src={img.url} 
                  alt={`Preview ${index}`}
                  className={`w-full h-24 object-cover rounded ${img.isDuplicate ? 'opacity-50 grayscale' : ''}`}
                />
                
                {/* Duplicate indicator */}
                {img.isDuplicate && (
                  <div className="absolute inset-0 flex items-center justify-center bg-red-500/80 rounded">
                    <div className="text-white text-center p-1">
                      <div className="font-bold text-xs">DUPLICATE</div>
                      <div className="text-xs">{img.duplicateReason}</div>
                    </div>
                  </div>
                )}
                
                {/* Upload status indicators */}
                {img.uploaded && !img.isDuplicate && (
                  <div className="absolute inset-0 flex items-center justify-center bg-green-500/80 rounded">
                    <div className="text-white font-bold">✓</div>
                  </div>
                )}
                {img.uploading && !img.isDuplicate && (
                  <div className="absolute inset-0 flex items-center justify-center bg-blue-500/80 rounded">
                    <Loader2 className="w-6 h-6 text-white animate-spin" />
                  </div>
                )}
                
                <button
                  onClick={() => removeImage(index)}
                  className="absolute top-1 right-1 bg-red-500 text-white p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="w-3 h-3" />
                </button>
                {img.exifData?.dateTime && !img.isDuplicate && (
                  <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-white text-xs p-1">
                    {new Date(img.exifData.dateTime).toLocaleDateString()}
                  </div>
                )}
              </div>
            ))}
            {images.length > 20 && (
              <div className="flex items-center justify-center bg-gray-100 rounded">
                <span className="text-sm text-gray-600">
                  +{images.length - 20} more
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
