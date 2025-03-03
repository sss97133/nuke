
import React, { useState } from 'react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { UploadCloud } from 'lucide-react';

// Import the new components
import { FileDropZone } from './file-import/FileDropZone';
import { ImportStatus } from './file-import/ImportStatus';
import { ImportOptions } from './file-import/ImportOptions';
import { SupportedFormats } from './file-import/SupportedFormats';
import { ImportHistory } from './file-import/ImportHistory';
import { validateFile } from './file-import/utils';

interface FileImportTabProps {
  className?: string;
}

const FileImportTab: React.FC<FileImportTabProps> = ({ className }) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [importStatus, setImportStatus] = useState<'idle' | 'processing' | 'success' | 'error'>('idle');
  const { toast } = useToast();
  
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const validationResult = validateFile(file);
      
      if (!validationResult.isValid) {
        toast({
          title: validationResult.errorTitle,
          description: validationResult.errorMessage,
          variant: "destructive",
        });
        return;
      }
      
      setSelectedFile(file);
      toast({
        title: "File selected",
        description: `${file.name} (${(file.size / 1024).toFixed(2)} KB)`,
        variant: "default",
      });
    }
  };
  
  const handleImport = () => {
    if (selectedFile) {
      setImportStatus('processing');
      
      // Show processing toast
      toast({
        title: "Processing import",
        description: "Please wait while we process your file...",
      });
      
      // Simulate processing
      setTimeout(() => {
        const success = Math.random() > 0.2;
        setImportStatus(success ? 'success' : 'error');
        
        // Show result toast
        if (success) {
          toast({
            title: "Import successful",
            description: `Successfully imported data from ${selectedFile.name}`,
            variant: "default",
          });
        } else {
          toast({
            title: "Import failed",
            description: "There was an error processing your import. Please try again.",
            variant: "destructive",
          });
        }
      }, 2000);
    }
  };
  
  const resetImport = () => {
    setSelectedFile(null);
    setImportStatus('idle');
  };

  return (
    <div className="grid gap-6 md:grid-cols-3">
      <div className="md:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle>Import Data File</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {importStatus === 'idle' && (
              <>
                <FileDropZone 
                  selectedFile={selectedFile}
                  handleFileChange={handleFileChange}
                  resetImport={resetImport}
                  handleImport={handleImport}
                />
                
                {!selectedFile && <ImportOptions />}
              </>
            )}
            
            <ImportStatus 
              status={importStatus} 
              resetImport={resetImport} 
              fileName={selectedFile?.name}
            />
          </CardContent>
          {importStatus === 'idle' && selectedFile && (
            <CardFooter className="border-t px-6 py-4">
              <Button onClick={handleImport} className="ml-auto">
                Start Import
              </Button>
            </CardFooter>
          )}
        </Card>
      </div>
      
      <div className="space-y-6">
        <SupportedFormats />
        <ImportHistory />
      </div>
    </div>
  );
};

export default FileImportTab;
