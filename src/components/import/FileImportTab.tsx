
import React, { useState } from 'react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Upload, FileText, FileSpreadsheet, UploadCloud, RefreshCcw,
  Check, AlertCircle
} from 'lucide-react';

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
      const fileExtension = file.name.split('.').pop()?.toLowerCase();
      
      // Validate file type
      const validFileTypes = ['csv', 'xlsx', 'json', 'xml'];
      if (!fileExtension || !validFileTypes.includes(fileExtension)) {
        toast({
          title: "Invalid file type",
          description: `Please select a CSV, XLSX, JSON, or XML file. You selected: ${fileExtension?.toUpperCase() || 'Unknown'}`,
          variant: "destructive",
        });
        return;
      }
      
      // Validate file size (max 10MB)
      const maxSize = 10 * 1024 * 1024; // 10MB
      if (file.size > maxSize) {
        toast({
          title: "File too large",
          description: `Maximum file size is 10MB. Your file is ${(file.size / (1024 * 1024)).toFixed(2)}MB`,
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
                
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="import-type">Import Type</Label>
                    <Select defaultValue="vehicles">
                      <SelectTrigger>
                        <SelectValue placeholder="Select import type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="vehicles">Vehicles</SelectItem>
                        <SelectItem value="inventory">Inventory</SelectItem>
                        <SelectItem value="customers">Customers</SelectItem>
                        <SelectItem value="services">Service Records</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="mapping">Field Mapping</Label>
                    <Select defaultValue="auto">
                      <SelectTrigger>
                        <SelectValue placeholder="Select mapping method" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">Auto-detect</SelectItem>
                        <SelectItem value="manual">Manual Mapping</SelectItem>
                        <SelectItem value="template">Use Template</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="conflict">Conflict Resolution</Label>
                    <Select defaultValue="skip">
                      <SelectTrigger>
                        <SelectValue placeholder="Select conflict handling" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="skip">Skip Duplicates</SelectItem>
                        <SelectItem value="overwrite">Overwrite Existing</SelectItem>
                        <SelectItem value="merge">Merge Records</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </>
            )}
            
            {importStatus === 'processing' && (
              <div className="text-center py-6">
                <RefreshCcw className="h-10 w-10 text-primary mx-auto mb-4 animate-spin" />
                <h3 className="font-medium mb-1">Processing Import</h3>
                <p className="text-sm text-muted-foreground">
                  Please wait while we import your data...
                </p>
              </div>
            )}
            
            {importStatus === 'success' && (
              <div className="text-center py-6">
                <Check className="h-10 w-10 text-green-500 mx-auto mb-4" />
                <h3 className="font-medium mb-1">Import Successful</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Your data has been successfully imported
                </p>
                <Button onClick={resetImport}>Import Another File</Button>
              </div>
            )}
            
            {importStatus === 'error' && (
              <div className="text-center py-6">
                <AlertCircle className="h-10 w-10 text-destructive mx-auto mb-4" />
                <h3 className="font-medium mb-1">Import Failed</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  There was an error importing your data. Please try again.
                </p>
                <Button onClick={resetImport}>Try Again</Button>
              </div>
            )}
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
        <Card>
          <CardHeader>
            <CardTitle>Supported File Types</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {[
                { icon: <FileSpreadsheet className="h-4 w-4 text-green-500" />, format: "CSV", desc: "Comma Separated Values" },
                { icon: <FileSpreadsheet className="h-4 w-4 text-blue-500" />, format: "XLSX", desc: "Excel Spreadsheet" },
                { icon: <FileText className="h-4 w-4 text-orange-500" />, format: "JSON", desc: "JavaScript Object Notation" },
                { icon: <FileText className="h-4 w-4 text-purple-500" />, format: "XML", desc: "Extensible Markup Language" }
              ].map((file, index) => (
                <div key={index} className="flex items-center gap-2 p-2">
                  {file.icon}
                  <div>
                    <h4 className="font-medium">{file.format}</h4>
                    <p className="text-xs text-muted-foreground">{file.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader>
            <CardTitle>Import History</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {[
                { file: "vehicles-may.csv", date: "May 10, 2024", records: 45 },
                { file: "inventory-q1.xlsx", date: "Apr 02, 2024", records: 128 },
                { file: "services-2023.json", date: "Mar 15, 2024", records: 312 }
              ].map((item, index) => (
                <div key={index} className="border-l-2 border-primary pl-3 py-1">
                  <div className="flex justify-between">
                    <h4 className="font-medium text-sm">{item.file}</h4>
                    <span className="text-xs text-muted-foreground">{item.date}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{item.records} records</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default FileImportTab;
