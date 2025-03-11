
import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Button } from '@/components/ui/button';
import { uploadVehicleImages, VehicleImageCategory, ImagePosition } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Loader2, UploadCloud, X, ImagePlus } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';

interface UploadProgress {
  file: string;
  progress: number;
  status: 'pending' | 'uploading' | 'success' | 'error';
  error?: string;
}

interface ImageUploaderProps {
  vehicleId: string;
  onSuccess?: (imageUrls: string[]) => void;
  maxSizeMB?: number;
  defaultCategory?: VehicleImageCategory;
  defaultPosition?: ImagePosition;
}

const ImageUploader: React.FC<ImageUploaderProps> = ({
  vehicleId,
  onSuccess,
  maxSizeMB = 10,
  defaultCategory = VehicleImageCategory.EXTERIOR,
  defaultPosition = ImagePosition.FRONT_34
}) => {
  const [isUploading, setIsUploading] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [category, setCategory] = useState<VehicleImageCategory>(defaultCategory);
  const [positions, setPositions] = useState<ImagePosition[]>([defaultPosition]);
  const [uploadProgress, setUploadProgress] = useState<Record<string, UploadProgress>>({});
  const toastMethods = useToast();

  // Get available positions based on selected category
  const getPositionsForCategory = (cat: VehicleImageCategory): ImagePosition[] => {
    switch (cat) {
      case VehicleImageCategory.EXTERIOR:
        return [
          ImagePosition.FRONT_34,
          ImagePosition.SIDE_DRIVER,
          ImagePosition.SIDE_PASSENGER,
          ImagePosition.REAR_34,
          ImagePosition.FRONT_DIRECT,
          ImagePosition.REAR_DIRECT
        ];
      case VehicleImageCategory.INTERIOR:
        return [
          ImagePosition.DASHBOARD,
          ImagePosition.CENTER_CONSOLE,
          ImagePosition.FRONT_SEATS,
          ImagePosition.REAR_SEATS,
          ImagePosition.TRUNK
        ];
      case VehicleImageCategory.DOCUMENTATION:
        return [
          ImagePosition.VIN,
          ImagePosition.ODOMETER,
          ImagePosition.WINDOW_STICKER,
          ImagePosition.TITLE
        ];
      case VehicleImageCategory.TECHNICAL:
        return [
          ImagePosition.ENGINE,
          ImagePosition.UNDERCARRIAGE,
          ImagePosition.WHEELS,
          ImagePosition.FEATURES
        ];
      case VehicleImageCategory.PRIMARY:
        return [ImagePosition.FRONT_34];
      default:
        return [];
    }
  };

  // Update positions when category changes
  const handleCategoryChange = (newCategory: VehicleImageCategory) => {
    setCategory(newCategory);
    const availablePositions = getPositionsForCategory(newCategory);
    setPositions(selectedFiles.map(() => availablePositions[0])); // Set all files to first available position
  };

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      setSelectedFiles(acceptedFiles);
      // Initialize positions for each file
      setPositions(acceptedFiles.map(() => defaultPosition));
    }
  }, [defaultPosition]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.jpeg', '.jpg', '.png', '.webp']
    },
    maxSize: maxSizeMB * 1024 * 1024,
    multiple: true
  });

  const handleUpload = async () => {
    if (selectedFiles.length === 0) return;
    
    try {
      setIsUploading(true);
      
      const imageUrls = await uploadVehicleImages(
        vehicleId,
        selectedFiles,
        category,
        positions,
        (progress) => setUploadProgress(progress),
        maxSizeMB
      );
      
      toastMethods.toast({
        title: 'Success',
        description: `${selectedFiles.length} image(s) uploaded successfully`,
      });
      
      onSuccess?.(imageUrls);
      
      // Reset the form
      setSelectedFiles([]);
      setPositions([defaultPosition]);
      setUploadProgress({});
    } catch (error: any) {
      console.error('Upload error:', error);
      toastMethods.toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'Failed to upload images',
      });
    } finally {
      setIsUploading(false);
    }
  };

  const removeFile = (index: number) => {
    const newFiles = [...selectedFiles];
    const newPositions = [...positions];
    newFiles.splice(index, 1);
    newPositions.splice(index, 1);
    setSelectedFiles(newFiles);
    setPositions(newPositions);
  };

  return (
    <div className="w-full">
      <div className="space-y-4 mb-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Category</Label>
            <Select 
              value={category} 
              onValueChange={(val: string) => handleCategoryChange(val as VehicleImageCategory)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                {Object.values(VehicleImageCategory).map((cat: string) => (
                  <SelectItem key={cat} value={cat}>
                    {cat.charAt(0).toUpperCase() + cat.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          <div className="space-y-2">
            <Label>Default Position</Label>
            <Select 
              value={positions[0]} 
              onValueChange={(val: string) => {
                const newPosition = val as ImagePosition;
                setPositions(selectedFiles.map(() => newPosition));
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select position" />
              </SelectTrigger>
              <SelectContent>
                {getPositionsForCategory(category).map((pos: string) => (
                  <SelectItem key={pos} value={pos}>
                    {pos.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {selectedFiles.length === 0 ? (
        <div
          {...getRootProps()}
          className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors
            ${isDragActive ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'}`}
        >
          <input {...getInputProps()} />
          <UploadCloud className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
          <p className="text-sm font-medium mb-1">Drag and drop images here</p>
          <p className="text-xs text-muted-foreground mb-3">
            JPG, PNG, WEBP up to {maxSizeMB}MB
          </p>
          <Button size="sm" type="button" variant="secondary">
            <ImagePlus className="h-4 w-4 mr-2" />
            Browse files
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {selectedFiles.map((file, index) => (
            <div key={file.name} className="rounded-lg border border-border p-4">
              <div className="flex items-center gap-4">
                <div className="h-10 w-10 rounded bg-muted flex items-center justify-center">
                  <ImagePlus className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(file.size / (1024 * 1024)).toFixed(2)} MB
                  </p>
                  {uploadProgress[file.name] && (
                    <div className="mt-2">
                      <Progress
                        value={uploadProgress[file.name].progress}
                        className="h-1"
                      />
                      {uploadProgress[file.name].error && (
                        <p className="text-xs text-destructive mt-1">
                          {uploadProgress[file.name].error}
                        </p>
                      )}
                    </div>
                  )}
                </div>
                <Select
                  value={positions[index]}
                  onValueChange={(val: string) => {
                    const newPositions = [...positions];
                    newPositions[index] = val as ImagePosition;
                    setPositions(newPositions);
                  }}
                >
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="Select position" />
                  </SelectTrigger>
                  <SelectContent>
                    {getPositionsForCategory(category).map((pos: string) => (
                      <SelectItem key={pos} value={pos}>
                        {pos.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0"
                  onClick={() => removeFile(index)}
                  disabled={isUploading}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ImageUploader;
