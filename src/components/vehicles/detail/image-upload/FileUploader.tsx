
import React, { useRef } from 'react';
import { Image, FolderOpen } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FileUploaderProps } from './types';

export const FileUploader: React.FC<FileUploaderProps> = ({ 
  handleFileChange,
  maxFiles = 10,
  maxSizeInMB = 10
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const openFileDialog = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileChange({
        target: {
          files: e.dataTransfer.files
        }
      } as React.ChangeEvent<HTMLInputElement>);
    }
  };

  return (
    <div className="space-y-2">
      <Label htmlFor="car-images">Upload Images</Label>
      <div 
        className="border-2 border-dashed rounded-lg p-6 text-center transition-all hover:bg-muted/50"
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={openFileDialog}
      >
        <Input
          id="car-images"
          type="file"
          ref={fileInputRef}
          multiple
          accept="image/*"
          onChange={handleFileChange}
          className="hidden"
        />
        
        <div className="flex flex-col items-center justify-center gap-3 py-4">
          <FolderOpen className="h-10 w-10 text-muted-foreground" />
          <div className="space-y-1 text-center">
            <p className="text-sm font-medium">
              Drag photos here or click to browse
            </p>
            <p className="text-xs text-muted-foreground">
              Supported formats: JPG, PNG, HEIC (Max {maxSizeInMB}MB each, up to {maxFiles} files)
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" className="mt-2">
            <Image className="h-4 w-4 mr-2" />
            Select Photos
          </Button>
        </div>
      </div>
    </div>
  );
};
