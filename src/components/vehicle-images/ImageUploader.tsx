import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useDropzone } from 'react-dropzone';
import { Button } from '@/components/ui/button';
import { uploadVehicleImage, VehicleImageCategory, ImagePosition } from '@/lib/image-upload';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, UploadCloud, X, ImagePlus, Upload } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';

interface UploadProgress {
  file: string;
  progress: number;
  status: 'uploading' | 'complete' | 'error';
  error?: string;
}

interface SelectedFile {
  file: File;
  preview: string;
  position: ImagePosition;
}

interface ImageUploaderProps {
  vehicleId: string;
  defaultCategory?: VehicleImageCategory;
  onUploadComplete?: (urls: string[]) => void;
  onError?: (error: string) => void;
}

const defaultPosition = ImagePosition.FRONT_34;

export const ImageUploader: React.FC<ImageUploaderProps> = ({
  vehicleId,
  defaultCategory = VehicleImageCategory.EXTERIOR,
  onUploadComplete,
  onError
}) => {
  const [isUploading, setIsUploading] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<SelectedFile[]>([]);
  const [category, setCategory] = useState<VehicleImageCategory>(defaultCategory);
  const [positions, setPositions] = useState<ImagePosition[]>([]);
  const [uploadProgress, setUploadProgress] = useState<Record<string, UploadProgress>>({});
  const toastMethods = useToast();

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      setSelectedFiles(acceptedFiles.map(file => ({
        file,
        preview: URL.createObjectURL(file),
        position: defaultPosition
      })));
      // Initialize positions for each file
      setPositions(acceptedFiles.map(() => defaultPosition));
    }
  }, []);

  const handleUpload = async () => {
    if (selectedFiles.length === 0) return;

    setIsUploading(true);
    setUploadProgress({});

    try {
      const uploadPromises = selectedFiles.map(async (file, index) => {
        const filePath = `${vehicleId}/${category}/${positions[index]}/${Date.now()}-${file.file.name}`;
        return uploadVehicleImage(
          'vehicle-images',
          file.file,
          filePath,
          (progress) => {
            setUploadProgress(prev => ({
              ...prev,
              [file.file.name]: {
                file: file.file.name,
                progress: progress.percentage,
                status: 'uploading'
              }
            }));
          }
        );
      });

      const urls = await Promise.all(uploadPromises);
      const validUrls = urls.filter((url): url is string => url !== null);

      if (validUrls.length > 0) {
        toastMethods.toast({
          title: "Success",
          description: "Images uploaded successfully",
        });
        onUploadComplete?.(validUrls);
      } else {
        throw new Error("No images were uploaded successfully");
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to upload images";
      toastMethods.toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
      onError?.(errorMessage);
    } finally {
      setIsUploading(false);
    }
  };

  useEffect(() => {
    if (selectedFiles.length > 0) {
      setPositions(selectedFiles.map(() => defaultPosition));
    }
  }, [selectedFiles]);

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
      case VehicleImageCategory.ENGINE:
        return [ImagePosition.ENGINE, ImagePosition.UNDERCARRIAGE];
      case VehicleImageCategory.DOCUMENTATION:
        return [
          ImagePosition.VIN,
          ImagePosition.ODOMETER,
          ImagePosition.WINDOW_STICKER,
          ImagePosition.TITLE
        ];
      default:
        return [ImagePosition.FEATURES];
    }
  };

  const availablePositions = getPositionsForCategory(category);

  const { getRootProps, getInputProps } = useDropzone({ onDrop });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <Select value={category} onValueChange={(value) => setCategory(value as VehicleImageCategory)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Select category" />
          </SelectTrigger>
          <SelectContent>
            {Object.values(VehicleImageCategory).map((cat) => (
              <SelectItem key={cat} value={cat}>
                {cat.charAt(0).toUpperCase() + cat.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          onClick={handleUpload}
          disabled={isUploading || selectedFiles.length === 0}
          className="flex items-center gap-2"
        >
          {isUploading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Uploading...
            </>
          ) : (
            <>
              <Upload className="h-4 w-4" />
              Upload Images
            </>
          )}
        </Button>
      </div>

      <div className="space-y-4">
        {selectedFiles.map((file, index) => (
          <div key={file.file.name} className="rounded-lg border border-border p-4">
            <div className="flex items-center gap-4">
              <div className="h-10 w-10 rounded bg-muted flex items-center justify-center">
                <ImagePlus className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{file.file.name}</p>
                <p className="text-xs text-muted-foreground">
                  {(file.file.size / (1024 * 1024)).toFixed(2)} MB
                </p>
                {uploadProgress[file.file.name] && (
                  <div className="mt-2">
                    <Progress
                      value={uploadProgress[file.file.name].progress}
                      className="h-1"
                    />
                    {uploadProgress[file.file.name].error && (
                      <p className="text-xs text-destructive mt-1">
                        {uploadProgress[file.file.name].error}
                      </p>
                    )}
                  </div>
                )}
              </div>
              <Select
                value={positions[index]}
                onValueChange={(value) => {
                  const newPositions = [...positions];
                  newPositions[index] = value as ImagePosition;
                  setPositions(newPositions);
                }}
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Select position" />
                </SelectTrigger>
                <SelectContent>
                  {availablePositions.map((pos) => (
                    <SelectItem key={pos} value={pos}>
                      {pos.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        ))}
      </div>

      <div
        {...getRootProps()}
        className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:bg-muted/50 transition-colors"
      >
        <input {...getInputProps()} />
        <Upload className="h-8 w-8 mx-auto text-muted-foreground" />
        <p className="mt-2 text-sm text-muted-foreground">
          Drag and drop images here, or click to select files
        </p>
      </div>
    </div>
  );
};

export default ImageUploader;
