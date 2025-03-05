
import React, { useState, useRef } from 'react';
import { FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Image, Upload, X, ImagePlus } from 'lucide-react';
import { UseFormReturn } from 'react-hook-form';
import { VehicleFormValues } from '../types';
import { useToast } from '@/hooks/use-toast';
import { ScrollArea } from '@/components/ui/scroll-area';

interface ImageUploadProps {
  form: UseFormReturn<VehicleFormValues>;
  name: keyof VehicleFormValues;
  label: string;
  description?: string;
  multiple?: boolean;
}

export const ImageUpload: React.FC<ImageUploadProps> = ({
  form,
  name,
  label,
  description,
  multiple = false
}) => {
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  
  // Handle file selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    // Process each file
    processFiles(files);
  };
  
  // Process the selected files
  const processFiles = (files: FileList) => {
    // Validate files
    const validFiles: File[] = [];
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      
      // Validate file type
      if (!file.type.startsWith('image/')) {
        toast({
          title: 'Invalid file type',
          description: `${file.name} is not an image file`,
          variant: 'destructive',
        });
        continue;
      }
      
      // Validate file size
      if (file.size > 5 * 1024 * 1024) { // 5MB limit
        toast({
          title: 'File too large',
          description: `${file.name} exceeds the 5MB limit`,
          variant: 'destructive',
        });
        continue;
      }
      
      validFiles.push(file);
    }
    
    if (validFiles.length === 0) return;
    
    // Create preview URLs
    const newPreviewUrls = validFiles.map(file => URL.createObjectURL(file));
    
    // If not multiple, replace the current preview URLs
    const updatedPreviewUrls = multiple 
      ? [...previewUrls, ...newPreviewUrls]
      : newPreviewUrls;
    
    setPreviewUrls(updatedPreviewUrls);
    
    // Simulate uploading
    setIsUploading(true);
    
    // In a real implementation, you would upload the files to your storage here
    // For now, we'll simulate the upload with a timeout
    setTimeout(() => {
      // After "upload", set the URLs in the form
      const imageValue = multiple 
        ? updatedPreviewUrls 
        : updatedPreviewUrls[0] || '';
      
      form.setValue(name as any, imageValue);
      setIsUploading(false);
      
      toast({
        title: 'Images uploaded',
        description: `${validFiles.length} image(s) have been uploaded successfully`,
      });
    }, 1500);
  };
  
  // Clear all images
  const clearAllImages = () => {
    form.setValue(name as any, multiple ? [] : '');
    previewUrls.forEach(url => URL.revokeObjectURL(url));
    setPreviewUrls([]);
  };
  
  // Clear a specific image
  const clearImage = (index: number) => {
    const newPreviewUrls = [...previewUrls];
    URL.revokeObjectURL(newPreviewUrls[index]);
    newPreviewUrls.splice(index, 1);
    setPreviewUrls(newPreviewUrls);
    
    if (multiple) {
      form.setValue(name as any, newPreviewUrls);
    } else if (newPreviewUrls.length > 0) {
      form.setValue(name as any, newPreviewUrls[0]);
    } else {
      form.setValue(name as any, '');
    }
  };
  
  // Handle drag events
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
    
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      processFiles(files);
    }
  };
  
  // Convert the form value to preview URLs if necessary
  const formValue = form.watch(name as any);
  const displayUrls = previewUrls.length > 0 ? previewUrls : (
    Array.isArray(formValue) ? formValue : (formValue ? [formValue] : [])
  );
  
  return (
    <FormField
      control={form.control}
      name={name as any}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <div className="space-y-4">
              {/* Preview Area */}
              {displayUrls.length > 0 && (
                <>
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium">
                      {displayUrls.length} {displayUrls.length === 1 ? 'image' : 'images'}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8"
                      onClick={clearAllImages}
                    >
                      Clear all
                    </Button>
                  </div>
                  
                  <ScrollArea className="h-48 border rounded-md">
                    <div className="grid grid-cols-3 gap-2 p-2">
                      {displayUrls.map((url, index) => (
                        <div key={index} className="relative aspect-square rounded-md overflow-hidden group">
                          <img 
                            src={url} 
                            alt={`Vehicle image ${index + 1}`} 
                            className="w-full h-full object-cover"
                          />
                          <Button
                            type="button"
                            variant="destructive"
                            size="icon"
                            className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => clearImage(index)}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </>
              )}
              
              {/* Upload Controls */}
              <div 
                className={`border-2 ${isDragging ? 'border-primary bg-primary/5' : 'border-dashed'} rounded-lg p-6 text-center hover:bg-muted/50 transition-colors`}
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
              >
                <Input
                  type="file"
                  id={`${name}-upload`}
                  ref={fileInputRef}
                  accept="image/*"
                  multiple={multiple}
                  className="hidden"
                  onChange={handleFileChange}
                  disabled={isUploading}
                />
                <label 
                  htmlFor={`${name}-upload`}
                  className="cursor-pointer block"
                >
                  <div className="flex flex-col items-center justify-center gap-2 py-4">
                    <ImagePlus className="h-10 w-10 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      {isUploading 
                        ? 'Uploading...' 
                        : isDragging 
                          ? 'Drop images here'
                          : 'Drag & drop images here or click to browse'
                      }
                    </p>
                    <Button 
                      type="button" 
                      variant="outline" 
                      size="sm" 
                      className="mt-2"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isUploading}
                    >
                      <Upload className="h-4 w-4 mr-2" />
                      {multiple ? 'Select Images' : 'Select Image'}
                    </Button>
                  </div>
                </label>
              </div>
              
              {description && <FormDescription>{description}</FormDescription>}
            </div>
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
};
