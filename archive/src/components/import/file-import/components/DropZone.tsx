
import React, { useCallback, useState } from 'react';
import { UploadCloud } from 'lucide-react';
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

interface DropZoneProps {
  fileInputRef: React.RefObject<HTMLInputElement>;
  handleFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  isDragging: boolean;
  setIsDragging: (isDragging: boolean) => void;
  handleBrowseClick: () => void;
}

export const DropZone: React.FC<DropZoneProps> = ({
  fileInputRef,
  handleFileChange,
  isDragging,
  setIsDragging,
  handleBrowseClick
}) => {
  const handleDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, [setIsDragging]);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, [setIsDragging]);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      // Create a synthetic event to pass to the handleFileChange function
      const event = {
        target: {
          files: e.dataTransfer.files
        }
      } as unknown as React.ChangeEvent<HTMLInputElement>;
      
      handleFileChange(event);
    }
  }, [handleFileChange, setIsDragging]);

  return (
    <>
      <UploadCloud className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
      <h3 className="font-medium mb-1">Drag and drop your file</h3>
      <p className="text-sm text-muted-foreground mb-4">
        Or click to browse for a file
      </p>
      <Input
        type="file"
        className="hidden"
        id="file-upload"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept=".csv,.xlsx,.json,.xml"
      />
      <Label htmlFor="file-upload" className="cursor-pointer">
        <Button 
          variant="outline" 
          type="button"
          onClick={handleBrowseClick}
        >
          <UploadCloud className="h-4 w-4 mr-2" />
          Browse Files
        </Button>
      </Label>
      <p className="text-xs text-muted-foreground mt-2">
        Supported formats: CSV, XLSX, JSON, XML (Max 10MB)
      </p>
    </>
  );
};
