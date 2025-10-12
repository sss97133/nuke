import React, { useState, useCallback, useRef } from 'react';
import type { Upload, X, Image, MapPin, Calendar, Info, Loader2 } from 'lucide-react';
import type { ImageExifService } from '../../services/imageExifServiceStub';
import { supabase } from '../../lib/supabase';

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
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    
    if (files.length > 500) {
      alert('Maximum 500 images at once. Please select fewer files.');
      return;
    }
    
    setIsProcessing(true);
    console.log(`Processing ${files.length} images...`);
    
    try {
      // Create preview objects
      const newImages: ImagePreview[] = files.map(file => ({
        file,
        url: URL.createObjectURL(file),
      }));
      
      setImages(prev => [...prev, ...newImages]);
      
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
    
    setIsProcessing(true);
    const uploadedUrls: string[] = [];
    
    try {
      // Upload in batches to avoid overwhelming the server
      const batchSize = 10;
      let uploaded = 0;
      
      for (let i = 0; i < images.length; i += batchSize) {
        const batch = images.slice(i, i + batchSize);
        
        await Promise.all(
          batch.map(async (img) => {
            try {
              const timestamp = Date.now();
              const ext = img.file.name.split('.').pop();
              const fileName = `${timestamp}_${Math.random().toString(36).substring(7)}.${ext}`;
              const filePath = `vehicles/${vehicleId}/images/${fileName}`;
              
              const { data, error } = await supabase.storage
                .from('vehicle-data')
                .upload(filePath, img.file);
              
              if (error) throw error;
              
              const { data: { publicUrl } } = supabase.storage
                .from('vehicle-data')
                .getPublicUrl(filePath);
              
              uploadedUrls.push(publicUrl);
              
              // Save to database with EXIF data
              await supabase.from('vehicle_images').insert({
                vehicle_id: vehicleId,
                image_url: publicUrl,
                category: 'general',
                metadata: {
                  originalName: img.file.name,
                  exifData: img.exifData,
                  uploadedAt: new Date().toISOString(),
                }
              });
              
              uploaded++;
              setUploadProgress(Math.round((uploaded / images.length) * 100));
            } catch (error) {
              console.error(`Error uploading ${img.file.name}:`, error);
            }
          })
        );
      }
      
      onImagesUploaded?.(uploadedUrls);
      console.log(`Uploaded ${uploadedUrls.length} images successfully`);
      
      // Clear after successful upload
      setImages([]);
      setUploadProgress(0);
      
    } catch (error) {
      console.error('Error uploading images:', error);
      console.error('Error uploading images');
    } finally {
      setIsProcessing(false);
    }
  };
  
  const removeImage = (index: number) => {
    setImages(prev => prev.filter((_, i) => i !== index));
  };
  
  return (
    <div className="space-y-4">
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
                  className="w-full h-24 object-cover rounded"
                />
                <button
                  onClick={() => removeImage(index)}
                  className="absolute top-1 right-1 bg-red-500 text-white p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="w-3 h-3" />
                </button>
                {img.exifData?.dateTime && (
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
