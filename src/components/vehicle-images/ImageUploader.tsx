
import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Button } from '@/components/ui/button';
import { uploadVehicleImage } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { Loader2, UploadCloud, X, ImagePlus } from 'lucide-react';

interface ImageUploaderProps {
  vehicleId: string;
  onSuccess?: (imageUrl: string) => void;
  maxSizeMB?: number;
}

const ImageUploader: React.FC<ImageUploaderProps> = ({
  vehicleId,
  onSuccess,
  maxSizeMB = 2
}) => {
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const toastMethods = useToast();

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      setSelectedFile(acceptedFiles[0]);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.jpeg', '.jpg', '.png', '.webp']
    },
    maxSize: maxSizeMB * 1024 * 1024,
    multiple: false
  });

  const handleUpload = async () => {
    if (!selectedFile) return;
    
    try {
      setIsUploading(true);
      setProgress(10);
      
      // Simulate progress updates
      const progressInterval = setInterval(() => {
        setProgress(prev => {
          const newProgress = prev + Math.floor(Math.random() * 15);
          return newProgress > 90 ? 90 : newProgress;
        });
      }, 500);
      
      const imageUrl = await uploadVehicleImage(
        vehicleId,
        selectedFile,
        maxSizeMB
      );
      
      clearInterval(progressInterval);
      setProgress(100);
      
      if (toastMethods) {
        toastMethods.success({
          title: 'Image uploaded',
          description: 'Your image has been successfully uploaded'
        });
      }
      
      if (onSuccess) {
        onSuccess(imageUrl);
      }
      
      // Reset the form
      setSelectedFile(null);
    } catch (error: any) {
      console.error('Upload error:', error);
      if (toastMethods) {
        toastMethods.error({
          title: 'Upload failed',
          description: error.message || 'There was an error uploading your image'
        });
      }
    } finally {
      setIsUploading(false);
      setProgress(0);
    }
  };

  const cancelUpload = () => {
    setSelectedFile(null);
  };

  return (
    <div className="w-full">
      {!selectedFile ? (
        <div
          {...getRootProps()}
          className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors
            ${isDragActive ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'}`}
        >
          <input {...getInputProps()} />
          <UploadCloud className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
          <p className="text-sm font-medium mb-1">Drag and drop your image here</p>
          <p className="text-xs text-muted-foreground mb-3">
            JPG, PNG, WEBP up to {maxSizeMB}MB
          </p>
          <Button size="sm" type="button" variant="secondary">
            <ImagePlus className="h-4 w-4 mr-2" />
            Browse files
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border border-border p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center">
              <div className="h-10 w-10 rounded bg-muted flex items-center justify-center">
                <ImagePlus className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="ml-3 max-w-[180px]">
                <p className="text-sm font-medium truncate">{selectedFile.name}</p>
                <p className="text-xs text-muted-foreground">
                  {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              {!isUploading && (
                <>
                  <Button 
                    size="sm" 
                    variant="outline" 
                    onClick={cancelUpload}
                  >
                    <X className="h-4 w-4 mr-1" />
                    Cancel
                  </Button>
                  <Button 
                    size="sm"
                    onClick={handleUpload}
                  >
                    <UploadCloud className="h-4 w-4 mr-1" />
                    Upload
                  </Button>
                </>
              )}
              
              {isUploading && (
                <Button size="sm" variant="outline" disabled>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Uploading ({progress}%)
                </Button>
              )}
            </div>
          </div>
          
          {isUploading && (
            <div className="w-full bg-muted rounded-full h-2.5 mt-2">
              <div 
                className="bg-primary h-2.5 rounded-full" 
                style={{ width: `${progress}%` }}
              ></div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ImageUploader;
