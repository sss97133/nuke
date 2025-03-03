
import React from 'react';
import { RefreshCcw, Check, AlertCircle, ListChecks } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";

interface ImportStatusProps {
  status: 'idle' | 'processing' | 'success' | 'error';
  resetImport: () => void;
  fileName?: string;
  importedCount?: number;
}

export const ImportStatus: React.FC<ImportStatusProps> = ({ 
  status, 
  resetImport,
  fileName,
  importedCount = 0
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
        <p className="text-sm text-muted-foreground mb-2">
          Successfully imported {importedCount} vehicles from {fileName}
        </p>
        <div className="flex flex-col space-y-2 items-center">
          <Link to="/discovered-vehicles" className="w-full max-w-xs">
            <Button variant="default" className="w-full">
              <ListChecks className="mr-2 h-4 w-4" />
              View Imported Vehicles
            </Button>
          </Link>
          <Button variant="outline" onClick={resetImport} className="w-full max-w-xs">
            Import Another File
          </Button>
        </div>
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
