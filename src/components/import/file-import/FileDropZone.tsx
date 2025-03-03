
import React from 'react';
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
  return (
    <div className="border-2 border-dashed rounded-lg p-6 text-center">
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
            onChange={handleFileChange}
            accept=".csv,.xlsx,.json,.xml"
          />
          <Label htmlFor="file-upload" className="cursor-pointer">
            <Button variant="outline" type="button">
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
