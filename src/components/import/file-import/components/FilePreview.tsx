
import React from 'react';
import { FileText } from 'lucide-react';
import { Button } from "@/components/ui/button";

interface FilePreviewProps {
  file: File;
  resetImport: () => void;
  processCsvImport: () => void;
  isProcessing: boolean;
}

export const FilePreview: React.FC<FilePreviewProps> = ({
  file,
  resetImport,
  processCsvImport,
  isProcessing
}) => {
  return (
    <div className="space-y-2">
      <FileText className="h-8 w-8 text-primary mx-auto mb-2" />
      <h3 className="font-medium">{file.name}</h3>
      <p className="text-sm text-muted-foreground">
        {(file.size / 1024).toFixed(2)} KB
      </p>
      <div className="flex gap-2 justify-center mt-2">
        <Button variant="outline" size="sm" onClick={resetImport}>
          Choose Different File
        </Button>
        <Button 
          size="sm" 
          onClick={processCsvImport} 
          disabled={isProcessing}
        >
          {isProcessing ? 'Processing...' : 'Import Now'}
        </Button>
      </div>
    </div>
  );
};
