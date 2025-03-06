import React, { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/components/ui/toast/toast-context';
import Papa from 'papaparse';
import { Loader2, Upload, AlertCircle, CheckCircle2, Download, Car } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface ImportedVehicle {
  make: string;
  model: string;
  year: number | string;
  color?: string;
  mileage?: number | string;
  vin?: string;
  ownership_status?: 'owned' | 'claimed' | 'discovered';
  [key: string]: any;
}

export default function BulkImport() {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [importedCount, setImportedCount] = useState(0);
  const [importStatus, setImportStatus] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const navigate = useNavigate();
  const [lastImportBatchId, setLastImportBatchId] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const selectedFile = e.target.files[0];
      if (selectedFile.type !== 'text/csv' && !selectedFile.name.endsWith('.csv')) {
        toast({
          title: 'Invalid file format',
          description: 'Please upload a CSV file',
          variant: 'destructive',
        });
        return;
      }
      setFile(selectedFile);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile.type !== 'text/csv' && !droppedFile.name.endsWith('.csv')) {
        toast({
          title: 'Invalid file format',
          description: 'Please upload a CSV file',
          variant: 'destructive',
        });
        return;
      }
      setFile(droppedFile);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const processImport = async () => {
    if (!file) {
      toast({
        title: 'No file selected',
        description: 'Please select a CSV file to import',
        variant: 'destructive',
      });
      return;
    }

    setIsUploading(true);
    setImportStatus('uploading');
    setErrorMessage('');

    try {
      // Get the current user
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        throw new Error('User not authenticated');
      }

      // Parse the CSV
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: true,
        complete: async (results) => {
          const vehicles = results.data.filter((vehicle: any) => {
            return vehicle.make && vehicle.model && vehicle.year;
          }) as ImportedVehicle[];

          if (vehicles.length === 0) {
            setImportStatus('error');
            setErrorMessage('No valid vehicle data found in the CSV');
            toast({
              title: 'Import failed',
              description: 'No valid vehicle data found in the CSV',
              variant: 'destructive',
            });
            setIsUploading(false);
            return;
          }

          let importedVehicles = 0;
          const batchId = `batch-${Date.now()}`;

          for (const vehicle of vehicles) {
            const processedVehicle = {
              ...vehicle,
              user_id: user.id,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              // Set default values for required fields if not present
              ownership_status: vehicle.ownership_status || 'discovered',
              year: typeof vehicle.year === 'string' ? parseInt(vehicle.year, 10) : vehicle.year,
              bulk_upload_batch_id: batchId,
            };

            const { error } = await supabase
              .from('vehicles')
              .insert([processedVehicle]);

            if (error) {
              console.error('Error importing vehicle:', error);
              continue;
            }

            importedVehicles++;
          }

          setImportedCount(importedVehicles);
          
          if (importedVehicles > 0) {
            setImportStatus('success');
            setLastImportBatchId(batchId);
            toast({
              title: 'Import successful',
              description: `Imported ${importedVehicles} vehicles from CSV`,
              variant: 'success',
            });
          } else {
            setImportStatus('error');
            setErrorMessage('Failed to import any vehicles');
            toast({
              title: 'Import failed',
              description: 'Failed to import any vehicles',
              variant: 'destructive',
            });
          }
          
          setIsUploading(false);
        },
        error: (error) => {
          setImportStatus('error');
          setErrorMessage(error.message);
          toast({
            title: 'CSV parsing error',
            description: error.message,
            variant: 'destructive',
          });
          setIsUploading(false);
        }
      });
    } catch (error: any) {
      setImportStatus('error');
      setErrorMessage(error.message);
      toast({
        title: 'Import error',
        description: error.message,
        variant: 'destructive',
      });
      setIsUploading(false);
    }
  };

  const handleBrowseClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const resetImport = () => {
    setFile(null);
    setImportStatus('idle');
    setImportedCount(0);
    setErrorMessage('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const viewVehicles = () => {
    if (lastImportBatchId) {
      navigate(`/vehicles?batch=${lastImportBatchId}`);
    } else {
      navigate('/vehicles');
    }
  };

  const downloadSampleCSV = () => {
    // Provide a direct link to the sample file
    window.open('/examples/vehicles_template.csv', '_blank');
  };

  return (
    <Card className="w-full max-w-3xl mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Upload className="w-5 h-5" />
          Import Vehicles
        </CardTitle>
      </CardHeader>
      <CardContent>
        {importStatus === 'idle' || importStatus === 'error' ? (
          <div 
            className={`border-2 ${isDragging ? 'border-primary bg-primary/5' : 'border-dashed'} rounded-lg p-8 text-center transition-colors hover:bg-slate-100/50 dark:hover:bg-slate-800/50`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              className="hidden"
              accept=".csv"
            />
            
            {!file ? (
              <div className="py-8">
                <Upload className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                <h3 className="text-lg font-medium mb-2">Drop your CSV file here or</h3>
                <Button variant="outline" onClick={handleBrowseClick}>
                  Browse Files
                </Button>
                
                <div className="mt-6 text-sm text-muted-foreground">
                  <p className="mb-2">CSV must include the following columns:</p>
                  <ul className="list-disc list-inside">
                    <li>make (required)</li>
                    <li>model (required)</li>
                    <li>year (required)</li>
                    <li>color (optional)</li>
                    <li>mileage (optional)</li>
                    <li>vin (optional)</li>
                    <li>ownership_status (optional: owned, claimed, discovered)</li>
                  </ul>
                  <div className="mt-4">
                    <Button variant="outline" size="sm" onClick={downloadSampleCSV} className="flex items-center gap-2">
                      <Download className="h-4 w-4" />
                      Download Sample CSV
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-8">
                <div className="flex items-center justify-center mb-4">
                  <div className="bg-primary/10 p-3 rounded-lg">
                    <Upload className="w-8 h-8 text-primary" />
                  </div>
                </div>
                <h3 className="text-lg font-medium">{file.name}</h3>
                <p className="text-sm text-muted-foreground mb-6">
                  {Math.round(file.size / 1024)} KB • CSV
                </p>
                
                {importStatus === 'error' && (
                  <div className="flex items-center gap-2 text-destructive text-sm mb-6">
                    <AlertCircle className="w-4 h-4" />
                    <span>{errorMessage}</span>
                  </div>
                )}
                
                <div className="flex gap-3 justify-center">
                  <Button variant="outline" onClick={resetImport}>
                    Change File
                  </Button>
                  <Button onClick={processImport}>
                    Import Vehicles
                  </Button>
                </div>
              </div>
            )}
          </div>
        ) : importStatus === 'uploading' ? (
          <div className="py-16 text-center">
            <Loader2 className="w-12 h-12 mx-auto mb-4 animate-spin text-primary" />
            <h3 className="text-lg font-medium">Importing vehicles...</h3>
            <p className="text-sm text-muted-foreground">
              This may take a moment depending on the file size
            </p>
          </div>
        ) : (
          <div className="py-16 text-center">
            <CheckCircle2 className="w-12 h-12 mx-auto mb-4 text-success" />
            <h3 className="text-lg font-medium">Import Successful!</h3>
            <p className="text-sm text-muted-foreground mb-2">
              Successfully imported {importedCount} vehicles from {file?.name}
            </p>
            <p className="text-sm text-muted-foreground mb-6">
              Your vehicles are now available in the <strong>Vehicles</strong> section.
              Click the button below to view them now.
            </p>
            <div className="flex gap-3 justify-center">
              <Button variant="outline" onClick={resetImport}>
                Import More
              </Button>
              <Button onClick={viewVehicles} className="gap-2">
                <Car className="h-4 w-4" />
                View My Vehicles
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
} 