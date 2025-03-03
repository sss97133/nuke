
import React from 'react';
import { RefreshCcw, Check, AlertCircle, ListChecks, FileText, Settings } from 'lucide-react';
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
        <p className="text-sm text-muted-foreground mb-4">
          Successfully imported {importedCount} vehicles from {fileName}
        </p>
        <div className="flex flex-col space-y-3 items-center max-w-xs mx-auto">
          <Link to="/discovered-vehicles" className="w-full">
            <Button variant="default" className="w-full">
              <ListChecks className="mr-2 h-4 w-4" />
              Organize & Verify Vehicles
            </Button>
          </Link>
          <p className="text-xs text-muted-foreground px-6">
            Use the Discovered Vehicles page to organize, verify, and add your imported vehicles to your garage
          </p>
          <div className="flex w-full space-x-2">
            <Button variant="outline" onClick={resetImport} className="flex-1">
              <FileText className="mr-2 h-4 w-4" />
              Import Another File
            </Button>
            <Link to="/settings" className="flex-1">
              <Button variant="outline" className="w-full">
                <Settings className="mr-2 h-4 w-4" />
                Settings
              </Button>
            </Link>
          </div>
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
