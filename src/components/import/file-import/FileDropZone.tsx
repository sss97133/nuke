
import React, { useCallback, useRef, useState } from 'react';
import { Upload, FileText, UploadCloud } from 'lucide-react';
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

interface FileDropZoneProps {
  selectedFile: File | null;
  handleFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  resetImport: () => void;
  handleImport: () => void;
}

export const FileDropZone: React.FC<FileDropZoneProps> = ({
  selectedFile,
  handleFileChange,
  resetImport,
  handleImport
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

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
      const file = e.dataTransfer.files[0];
      
      // Create a new event with the file
      const event = {
        target: {
          files: e.dataTransfer.files
        }
      } as unknown as React.ChangeEvent<HTMLInputElement>;
      
      handleFileChange(event);
    }
  }, [handleFileChange]);

  const handleBrowseClick = () => {
    console.log("Browse button clicked");
    if (fileInputRef.current) {
      console.log("Triggering file input click");
      fileInputRef.current.click();
    }
  };

  return (
    <div
      className={`border-2 ${isDragging ? 'border-primary bg-primary/5' : 'border-dashed'} rounded-lg p-6 text-center transition-colors`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {!selectedFile ? (
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
              <Upload className="h-4 w-4 mr-2" />
              Browse Files
            </Button>
          </Label>
          <p className="text-xs text-muted-foreground mt-2">
            Supported formats: CSV, XLSX, JSON, XML (Max 10MB)
          </p>
        </>
      ) : (
        <div className="space-y-2">
          <FileText className="h-8 w-8 text-primary mx-auto mb-2" />
          <h3 className="font-medium">{selectedFile.name}</h3>
          <p className="text-sm text-muted-foreground">
            {(selectedFile.size / 1024).toFixed(2)} KB
          </p>
          <div className="flex gap-2 justify-center mt-2">
            <Button variant="outline" size="sm" onClick={resetImport}>
              Choose Different File
            </Button>
            <Button size="sm" onClick={handleImport}>
              Import Now
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
