import React, { useState, useEffect, useRef } from 'react';
import { UseFormReturn } from 'react-hook-form';
import { FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { Image, Upload, X, ImagePlus, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AspectRatio } from '@/components/ui/aspect-ratio';
import { validateImageFile, ImageValidationOptions } from '@/lib/validation/image-validation';
import { VehicleFormValues } from '@/components/vehicles/forms/types';

interface ImageUploadProps {
  vehicleId?: string;
  form?: UseFormReturn<VehicleFormValues>;
  name?: keyof VehicleFormValues;
  label?: string;
  description?: string;
  multiple?: boolean;
  maxSize?: number;
  maxFiles?: number;
  onUploadComplete?: (urls: string[]) => void;
  onError?: (error: string) => void;
  validationOptions?: ImageValidationOptions;
}

export const ImageUpload: React.FC<ImageUploadProps> = ({
  vehicleId,
  form,
  name,
  label,
  description,
  multiple = false,
  maxSize,
  maxFiles = 10,
  onUploadComplete,
  onError,
  validationOptions
}) => {
  const [isUploading, setIsUploading] = useState(false);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  // Cleanup object URLs on unmount
  useEffect(() => {
    return () => {
      previewUrls.forEach(url => {
        if (url.startsWith('blob:')) {
          URL.revokeObjectURL(url);
        }
      });
    };
  }, [previewUrls]);

  const validateFiles = async (files: File[]): Promise<File[]> => {
    const validFiles: File[] = [];
    
    for (const file of files) {
      const result = await validateImageFile(file, validationOptions);
      if (result.valid) {
        validFiles.push(file);
      } else {
        toast({
          title: 'Invalid file',
          description: result.error,
          variant: 'destructive',
        });
        onError?.(result.error || 'Invalid file');
      }
    }
    
    return validFiles;
  };

  const processFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    // Convert FileList to Array
    const fileArray = Array.from(files);

    // Check max files
    if (fileArray.length > maxFiles) {
      toast({
        title: 'Too many files',
        description: `You can upload a maximum of ${maxFiles} files at once.`,
        variant: 'destructive',
      });
      onError?.(`Maximum ${maxFiles} files allowed`);
      return;
    }

    // Validate files
    const validFiles = await validateFiles(fileArray);
    if (validFiles.length === 0) return;

    // Create preview URLs
    const newPreviewUrls = validFiles.map(file => URL.createObjectURL(file));
    
    // Update preview URLs
    const updatedPreviewUrls = multiple 
      ? [...previewUrls, ...newPreviewUrls]
      : newPreviewUrls;
    
    setPreviewUrls(updatedPreviewUrls);

    // If form is provided, update form value
    if (form && name) {
      const imageValue = multiple 
        ? updatedPreviewUrls 
        : updatedPreviewUrls[0] || '';
      
      form.setValue(name, imageValue as VehicleFormValues[typeof name]);
    }

    // If onUploadComplete is provided, call it with the URLs
    if (onUploadComplete) {
      onUploadComplete(updatedPreviewUrls);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    processFiles(e.target.files);
  };

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    processFiles(e.dataTransfer.files);
  };

  const clearAllImages = () => {
    previewUrls.forEach(url => {
      if (url.startsWith('blob:')) {
        URL.revokeObjectURL(url);
      }
    });
    setPreviewUrls([]);
    
    if (form && name) {
      form.setValue(name, (multiple ? [] : '') as VehicleFormValues[typeof name]);
    }
  };

  const clearImage = (index: number) => {
    const newPreviewUrls = [...previewUrls];
    if (newPreviewUrls[index].startsWith('blob:')) {
      URL.revokeObjectURL(newPreviewUrls[index]);
    }
    newPreviewUrls.splice(index, 1);
    setPreviewUrls(newPreviewUrls);
    
    if (form && name) {
      if (multiple) {
        form.setValue(name, newPreviewUrls as VehicleFormValues[typeof name]);
      } else if (newPreviewUrls.length > 0) {
        form.setValue(name, newPreviewUrls[0] as VehicleFormValues[typeof name]);
      } else {
        form.setValue(name, '' as VehicleFormValues[typeof name]);
      }
    }
  };

  const renderContent = () => (
    <div className="space-y-4">
      {/* Preview Area */}
      {previewUrls.length > 0 && (
        <ScrollArea className="h-[200px] rounded-md border p-4">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {previewUrls.map((url, index) => (
              <div key={url} className="relative group">
                <AspectRatio ratio={1}>
                  <img 
                    src={url} 
                    alt={`Preview ${index + 1}`}
                    className="rounded-md object-cover w-full h-full"
                    onError={(e) => {
                      e.currentTarget.src = '/placeholder.svg';
                    }}
                  />
                </AspectRatio>
                <Button
                  variant="destructive"
                  size="icon"
                  className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => clearImage(index)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}

      {/* Upload Area */}
      <div
        className={`
          border-2 border-dashed rounded-lg p-8 text-center cursor-pointer
          transition-colors ${isDragging ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'}
        `}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple={multiple}
          onChange={handleFileChange}
          className="hidden"
          disabled={isUploading}
        />
        
        <div className="flex flex-col items-center justify-center gap-3">
          {isUploading ? (
            <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
          ) : (
            <ImagePlus className="h-10 w-10 text-muted-foreground" />
          )}
          <div className="space-y-1 text-center">
            <p className="text-sm font-medium">
              {isUploading 
                ? 'Uploading...' 
                : 'Drag & drop images here or click to browse'
              }
            </p>
            <p className="text-xs text-muted-foreground">
              Supported formats: JPG, PNG, WEBP, HEIC (Max {maxSize ? `${maxSize / (1024 * 1024)}MB` : '10MB'} each)
            </p>
          </div>
          <Button 
            type="button" 
            variant="outline" 
            size="sm" 
            className="mt-2"
            disabled={isUploading}
          >
            <Upload className="h-4 w-4 mr-2" />
            {multiple ? 'Select Images' : 'Select Image'}
          </Button>
        </div>
      </div>
    </div>
  );

  // If form is provided, wrap in FormField
  if (form && name) {
    return (
      <FormField
        control={form.control}
        name={name}
        render={({ field }) => (
          <FormItem>
            {label && <FormLabel>{label}</FormLabel>}
            <FormControl>
              {renderContent()}
            </FormControl>
            {description && <FormDescription>{description}</FormDescription>}
            <FormMessage />
          </FormItem>
        )}
      />
    );
  }

  // Otherwise render directly
  return renderContent();
}; 