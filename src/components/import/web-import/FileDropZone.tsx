
import React, { useCallback, useRef } from 'react';
import { Upload, FileText } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { validateWebImportFile } from './utils';

interface FileDropZoneProps {
  selectedFile: File | null;
  setSelectedFile: (file: File | null) => void;
}

export const FileDropZone: React.FC<FileDropZoneProps> = ({ 
  selectedFile, 
  setSelectedFile 
}) => {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = React.useState(false);

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
      const file = e.dataTransfer.files[0];
      const validationResult = validateWebImportFile(file);
      
      if (validationResult.isValid) {
        setSelectedFile(file);
        toast({
          title: "File selected for web import",
          description: `${file.name} (${(file.size / 1024).toFixed(2)} KB) - ${file.name.split('.').pop()?.toUpperCase()}`,
        });
      } else {
        toast({
          title: validationResult.errorTitle,
          description: validationResult.errorMessage,
          variant: "destructive",
        });
      }
    }
  }, [toast, setSelectedFile]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    console.log("File input change triggered");
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const validationResult = validateWebImportFile(file);
      
      if (validationResult.isValid) {
        setSelectedFile(file);
        toast({
          title: "File selected for web import",
          description: `${file.name} (${(file.size / 1024).toFixed(2)} KB) - ${file.name.split('.').pop()?.toUpperCase()}`,
        });
      } else {
        toast({
          title: validationResult.errorTitle,
          description: validationResult.errorMessage,
          variant: "destructive",
        });
      }
    }
  };

  const clearFile = () => {
    setSelectedFile(null);
  };

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
          <Upload className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
          <h3 className="font-medium mb-1">Drop your web file here</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Or click to browse for a file
          </p>
          <Input
            type="file"
            className="hidden"
            id="web-file-upload"
            onChange={handleFileChange}
            accept=".html,.xml,.json,.csv"
            ref={fileInputRef}
          />
          <Button 
            variant="outline" 
            type="button" 
            onClick={handleBrowseClick}
          >
            <Upload className="h-4 w-4 mr-2" />
            Browse Web Files
          </Button>
          <p className="text-xs text-muted-foreground mt-2">
            Supported formats: HTML, XML, JSON, CSV (Max 10MB)
          </p>
        </>
      ) : (
        <div className="space-y-2">
          <FileText className="h-8 w-8 text-primary mx-auto mb-2" />
          <h3 className="font-medium">{selectedFile.name}</h3>
          <p className="text-sm text-muted-foreground">
            {(selectedFile.size / 1024).toFixed(2)} KB
          </p>
          <Button variant="outline" size="sm" onClick={clearFile} className="mt-2">
            Choose Different File
          </Button>
        </div>
      )}
    </div>
  );
};
