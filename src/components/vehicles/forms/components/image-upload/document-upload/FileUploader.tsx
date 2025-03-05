import React, { useRef } from 'react';
import { Image, FolderOpen } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface FileUploaderProps {
  handleFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  maxFiles?: number;
  maxSizeInMB?: number;
  label?: string;
  description?: string;
  acceptTypes?: string;
}

export const FileUploader: React.FC<FileUploaderProps> = ({ 
  handleFileChange,
  maxFiles = 2,
  maxSizeInMB = 10,
  label = "Upload Documents",
  description = "Supported formats: PDF, JPG, PNG (Max 10MB each)",
  acceptTypes = "image/*,.pdf"
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
      <Label htmlFor="document-upload">{label}</Label>
      <div 
        className="border-2 border-dashed rounded-lg p-4 text-center transition-all hover:bg-muted/50"
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={openFileDialog}
      >
        <Input
          id="document-upload"
          type="file"
          ref={fileInputRef}
          multiple={maxFiles > 1}
          accept={acceptTypes}
          onChange={handleFileChange}
          className="hidden"
        />
        
        <div className="flex flex-col items-center justify-center gap-2 py-3">
          <FolderOpen className="h-8 w-8 text-muted-foreground" />
          <div className="space-y-1 text-center">
            <p className="text-sm font-medium">
              Drag documents here or click to browse
            </p>
            <p className="text-xs text-muted-foreground">
              {description}
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" className="mt-1">
            <Image className="h-4 w-4 mr-2" />
            Select Files
          </Button>
        </div>
      </div>
    </div>
  );
};
