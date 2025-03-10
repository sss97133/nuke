
import React, { useState } from 'react';
import { useToast } from '@/components/ui/toast';
import { Upload, XCircle, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { uploadVehicleImage } from '@/lib/supabase';
import { validateImageFile } from '@/utils/fileUpload';

interface ImageUploaderProps {
  vehicleId: string;
  onSuccess?: (imageUrl: string) => void;
  maxSizeMB?: number;
}

const ImageUploader: React.FC<ImageUploaderProps> = ({ 
  vehicleId, 
  onSuccess,
  maxSizeMB = 2 // Default to 2MB max size
}) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();
  
  const MAX_FILE_SIZE = maxSizeMB * 1024 * 1024; // Convert MB to bytes

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    setError(null);
    
    if (!file) return;
    
    // Validate file using the utility function
    const validation = validateImageFile(file, { maxSizeInMB: maxSizeMB });
    
    if (!validation.valid) {
      setError(validation.error || 'Invalid file');
      setSelectedFile(null);
      return;
    }
    
    setSelectedFile(file);
  };

  const handleUpload = async () => {
    if (!selectedFile || !vehicleId) return;
    
    try {
      setIsUploading(true);
      setUploadProgress(0);
      setError(null);
      
      // Simulate progress updates
      const progressInterval = setInterval(() => {
        setUploadProgress(prev => {
          if (prev >= 90) {
            clearInterval(progressInterval);
            return prev;
          }
          return prev + 10;
        });
      }, 300);
      
      console.log('Starting upload for vehicle:', vehicleId);
      
      // Use the uploadVehicleImage helper function
      const publicUrl = await uploadVehicleImage(vehicleId, selectedFile, maxSizeMB);
      
      clearInterval(progressInterval);
      setUploadProgress(100);
      
      console.log('Upload successful, URL:', publicUrl);
      
      toast({
        title: "Image uploaded successfully",
        description: "Your image has been added to the vehicle gallery.",
        variant: "success",
      });
      
      // Call the success callback with the new image URL
      if (onSuccess) {
        console.log('Calling onSuccess callback with URL:', publicUrl);
        onSuccess(publicUrl);
      }
      
      setSelectedFile(null);
      
      // Reset progress after a delay
      setTimeout(() => {
        setUploadProgress(0);
        setIsUploading(false);
      }, 1000);
      
    } catch (err: any) {
      console.error('Error uploading image:', err);
      setError(err.message || 'Failed to upload image');
      toast({
        title: "Upload failed",
        description: err.message || 'Failed to upload image',
        variant: "destructive",
      });
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  return (
    <div className="border border-border rounded-lg p-4 space-y-4">
      <div className="flex flex-col items-center justify-center">
        <h3 className="text-lg font-medium mb-2">Add Vehicle Photos</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Upload images of your vehicle (max {maxSizeMB}MB)
        </p>
        
        <div className="w-full">
          <div className="border-2 border-dashed border-border rounded-lg p-6 flex flex-col items-center justify-center">
            <Upload className="w-10 h-10 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground mb-4">
              Drag and drop an image or click to browse
            </p>
            
            <label className="relative">
              <Button variant="outline" type="button">
                Select Image
              </Button>
              <input
                type="file"
                accept="image/*"
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                onChange={handleFileChange}
                disabled={isUploading}
              />
            </label>
          </div>
        </div>
        
        {selectedFile && (
          <div className="mt-4 w-full">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center">
                <CheckCircle2 className="w-5 h-5 text-green-500 mr-2" />
                <span className="text-sm">{selectedFile.name}</span>
              </div>
              <span className="text-xs text-muted-foreground">
                {(selectedFile.size / (1024 * 1024)).toFixed(2)}MB
              </span>
            </div>
            
            <Button 
              className="w-full mt-2" 
              onClick={handleUpload}
              disabled={isUploading || !!error}
            >
              {isUploading ? 'Uploading...' : 'Upload Image'}
            </Button>
          </div>
        )}
        
        {isUploading && (
          <div className="w-full mt-4">
            <div className="flex justify-between mb-1">
              <span className="text-sm">Uploading...</span>
              <span className="text-sm">{uploadProgress}%</span>
            </div>
            <Progress value={uploadProgress} className="h-2" />
          </div>
        )}
        
        {error && (
          <div className="mt-4 w-full p-3 bg-destructive/15 border border-destructive rounded-md flex items-start">
            <AlertTriangle className="w-5 h-5 text-destructive mr-2 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-destructive">Upload Error</p>
              <p className="text-xs text-destructive/90">{error}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ImageUploader;
