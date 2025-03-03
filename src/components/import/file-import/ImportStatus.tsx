
import React from 'react';
import { RefreshCcw, Check, AlertCircle } from 'lucide-react';
import { Button } from "@/components/ui/button";

interface ImportStatusProps {
  status: 'idle' | 'processing' | 'success' | 'error';
  resetImport: () => void;
  fileName?: string;
}

export const ImportStatus: React.FC<ImportStatusProps> = ({ 
  status, 
  resetImport,
  fileName 
}) => {
  if (status === 'processing') {
    return (
      <div className="text-center py-6">
        <RefreshCcw className="h-10 w-10 text-primary mx-auto mb-4 animate-spin" />
        <h3 className="font-medium mb-1">Processing Import</h3>
        <p className="text-sm text-muted-foreground">
          Please wait while we import your data...
        </p>
      </div>
    );
  }
  
  if (status === 'success') {
    return (
      <div className="text-center py-6">
        <Check className="h-10 w-10 text-green-500 mx-auto mb-4" />
        <h3 className="font-medium mb-1">Import Successful</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Your data has been successfully imported
        </p>
        <Button onClick={resetImport}>Import Another File</Button>
      </div>
    );
  }
  
  if (status === 'error') {
    return (
      <div className="text-center py-6">
        <AlertCircle className="h-10 w-10 text-destructive mx-auto mb-4" />
        <h3 className="font-medium mb-1">Import Failed</h3>
        <p className="text-sm text-muted-foreground mb-4">
          There was an error importing your data. Please try again.
        </p>
        <Button onClick={resetImport}>Try Again</Button>
      </div>
    );
  }
  
  return null;
};
