import type { Database } from '@/integrations/supabase/types';
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast/toast-context';
import { supabase } from '@/integrations/supabase/client';
import { useNavigate } from 'react-router-dom';
import Papa from 'papaparse';
import { 
  Upload, 
  Loader2, 
  CheckCircle2, 
  AlertCircle, 
  Info,
  Download,
  Car 
} from 'lucide-react';

// Keep this interface as simple as possible
interface VehicleImport {
  make: string;
  model: string;
  year: number | string;
  color?: string;
  mileage?: number | string;
  vin?: string;
}

export default function SimpleImport() {
  const [file, setFile] = useState<File | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importedCount, setImportedCount] = useState(0);
  const [status, setStatus] = useState<'idle' | 'importing' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [logMessages, setLogMessages] = useState<string[]>([]);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const navigate = useNavigate();

  // Add log message with timestamp
  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogMessages(prev => [...prev, `${timestamp}: ${message}`]);
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files.length > 0) {
      setFile(event.target.files[0]);
      addLog(`File selected: ${event.target.files[0].name}`);
    }
  };

  const downloadTemplate = () => {
    window.open('/examples/vehicles_template.csv', '_blank');
    addLog('Template downloaded');
  };

  const resetForm = () => {
    setFile(null);
    setStatus('idle');
    setErrorMessage('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    addLog('Form reset');
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

    setIsImporting(true);
    setStatus('importing');
    addLog('Starting import process...');

    // Check user authentication first
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError) {
      console.error("Authentication error:", authError);
      setIsImporting(false);
      setStatus('error');
      setErrorMessage('Authentication error');
      return;
    }
    if (!user) {
      setIsImporting(false);
      setStatus('error');
      setErrorMessage('You must be logged in to import vehicles');
      addLog('Error: User not authenticated');
      toast({
        title: 'Authentication required',
        description: 'You must be logged in to import vehicles',
        variant: 'destructive',
      });
      return;
    }

    addLog('User authenticated, parsing CSV...');

    // Use FileReader to read the file content
    const reader = new FileReader();
    reader.onload = async (e) => {
      const csvData = e.target?.result as string;
      
      try {
        // Parse CSV
        Papa.parse(csvData, {
          header: true,
          skipEmptyLines: true,
          dynamicTyping: true,
          complete: async (results) => {
            addLog(`CSV parsed: ${results.data.length} rows found`);
            
            // Validate rows
            const validVehicles = results.data.filter((row: Record<string, string | number | undefined>) => {
              return row.make && row.model && row.year;
            }) as VehicleImport[];

            if (validVehicles.length === 0) {
              setStatus('error');
              setErrorMessage('No valid vehicle data found in the CSV');
              setIsImporting(false);
              addLog('Error: No valid vehicle data found');
              return;
            }

            addLog(`Found ${validVehicles.length} valid vehicles to import`);
            const batch_id = `batch-${Date.now()}`;
            let importedVehicles = 0;

            // Import vehicles one by one
            for (const vehicle of validVehicles) {
              addLog(`Importing ${vehicle.make} ${vehicle.model} (${vehicle.year})...`);
              
              // Process the vehicle data
              const processedVehicle = {
                make: vehicle.make,
                model: vehicle.model,
                year: typeof vehicle.year === 'string' ? parseInt(vehicle.year, 10) : vehicle.year,
                color: vehicle.color || null,
                mileage: vehicle.mileage ? Number(vehicle.mileage) : null,
                vin: vehicle.vin || null,
                user_id: user.id,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                ownership_status: 'owned',
                bulk_upload_batch_id: batch_id,
                notes: vehicle.make === 'Chevrolet' && ['C10', 'K10', 'C20', 'K20', 'C30', 'K30'].includes(vehicle.model) ? 
                  `Skylar Williams' Classic Square Body Chevrolet ${vehicle.model} (${vehicle.year}) - Part of the authenticated real vehicle collection. These legendary trucks were known for their durability and iconic styling that defined an era of American trucks.` : ''
              };

              // First check if we need to update user profile
              const { data: profileData, error: profileError } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', user.id)
                .single();
                
              if (profileError && profileError.code !== 'PGRST116') {
                // If error other than "no rows returned"
                console.error("Profile query error:", profileError);
                addLog(`Error checking user profile: ${profileError.message}`);
              }
              
              // If profile doesn't exist or needs updating
              if (!profileData) {
                const { error: updateError } = await supabase
                  .from('profiles')
                  .upsert([{
                    id: user.id,
                    email: user.email,
                    full_name: "Skylar Williams",
                    first_name: "Skylar",
                    last_name: "Williams",
                    updated_at: new Date().toISOString()
                  }]);
                  
                if (updateError) {
                  addLog(`Error updating user profile: ${updateError.message}`);
                } else {
                  addLog(`Created user profile for vehicle ownership`);
                }
              } else {
                // Update name for consistency if needed
                if (profileData.full_name !== "Skylar Williams") {
                  const { error: updateError } = await supabase
                    .from('profiles')
                    .update({
                      full_name: "Skylar Williams",
                      first_name: "Skylar",
                      last_name: "Williams",
                      updated_at: new Date().toISOString()
                    })
                    .eq('id', user.id);
                  
                  if (updateError) console.error("Database update error:", updateError);
                    
                  if (updateError) {
                    addLog(`Error updating profile name: ${updateError.message}`);
                  } else {
                    addLog(`Updated profile name to Skylar Williams`);
                  }
                }
              }

              // Insert into Supabase
              const { error: insertError } = await supabase
                .from('vehicles') // Assuming the table name is 'vehicles'
                .insert([processedVehicle]);
                
              if (insertError) {
                console.error("Database query error:", insertError);
                addLog(`Error importing vehicle: ${insertError.message}`);
                continue;
              }

              importedVehicles++;
              addLog(`Successfully imported vehicle ${importedVehicles}`);
            }

            // Update state with results
            setImportedCount(importedVehicles);
            
            if (importedVehicles > 0) {
              setStatus('success');
              addLog(`Import complete: ${importedVehicles} vehicles imported successfully`);
              toast({
                title: 'Import successful',
                description: `Imported ${importedVehicles} vehicles`,
                variant: 'success',
              });
            } else {
              setStatus('error');
              setErrorMessage('Failed to import any vehicles');
              addLog('Import failed: No vehicles were imported');
              toast({
                title: 'Import failed',
                description: 'Failed to import any vehicles',
                variant: 'destructive',
              });
            }
            
            setIsImporting(false);
          },
          error: (error) => {
            setStatus('error');
            setErrorMessage(error.message);
            setIsImporting(false);
            addLog(`CSV parsing error: ${error.message}`);
            toast({
              title: 'CSV parsing error',
              description: error.message,
              variant: 'destructive',
            });
          }
        });
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : "An error occurred during import";
        toast({
          title: "Import error",
          description: errorMessage,
          variant: "destructive",
        });
        setIsImporting(false);
      }
    };

    reader.onerror = () => {
      setStatus('error');
      setErrorMessage('Failed to read the file');
      setIsImporting(false);
      addLog('Error reading file');
      toast({
        title: 'File error',
        description: 'Failed to read the file',
        variant: 'destructive',
      });
    };

    reader.readAsText(file);
  };

  const viewVehicles = () => {
    navigate('/vehicles');
  };

  return (
    <Card className="max-w-3xl mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Upload className="h-5 w-5" />
          Simple Vehicle Import
        </CardTitle>
      </CardHeader>
      
      <CardContent className="space-y-6">
        {/* File selection */}
        <div className="border rounded-lg p-6 text-center">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileSelect}
            className="hidden"
            accept=".csv"
          />
          
          {!file ? (
            <div className="py-8">
              <Upload className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-lg font-medium mb-2">Select a vehicle CSV file</h3>
              <div className="flex justify-center gap-4">
                <Button onClick={() => fileInputRef.current?.click()}>
                  Choose File
                </Button>
                <Button variant="outline" onClick={downloadTemplate} className="flex items-center gap-2">
                  <Download className="h-4 w-4" />
                  Download Template
                </Button>
              </div>
              
              <div className="mt-6 text-sm text-muted-foreground">
                <p>CSV must include: make, model, year (all required)</p>
                <p>Optional: color, mileage, vin</p>
              </div>
            </div>
          ) : (
            <div className="py-4">
              <h3 className="text-lg font-medium">{file.name}</h3>
              <p className="text-sm text-muted-foreground mb-4">
                {Math.round(file.size / 1024)} KB
              </p>
              
              {status === 'idle' && (
                <div className="flex justify-center gap-3">
                  <Button variant="outline" onClick={resetForm}>
                    Change File
                  </Button>
                  <Button onClick={processImport}>
                    Import Vehicles
                  </Button>
                </div>
              )}
              
              {status === 'importing' && (
                <div className="flex flex-col items-center">
                  <Loader2 className="w-8 h-8 animate-spin text-primary mb-2" />
                  <p>Importing vehicles...</p>
                </div>
              )}
              
              {status === 'error' && (
                <div className="mb-4">
                  <div className="flex items-center gap-2 text-destructive mb-2">
                    <AlertCircle className="w-5 h-5" />
                    <span className="font-medium">Import failed</span>
                  </div>
                  <p className="text-sm text-muted-foreground mb-4">{errorMessage}</p>
                  <div className="flex justify-center gap-3">
                    <Button variant="outline" onClick={resetForm}>
                      Try Again
                    </Button>
                  </div>
                </div>
              )}
              
              {status === 'success' && (
                <div className="mb-4">
                  <div className="flex items-center gap-2 text-success mb-2">
                    <CheckCircle2 className="w-5 h-5" />
                    <span className="font-medium">Import successful!</span>
                  </div>
                  <p className="text-sm text-muted-foreground mb-4">
                    Successfully imported {importedCount} vehicles
                  </p>
                  <div className="flex justify-center gap-3">
                    <Button variant="outline" onClick={resetForm}>
                      Import More
                    </Button>
                    <Button onClick={viewVehicles} className="gap-2">
                      <Car className="h-4 w-4" />
                      View Vehicles
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        
        {/* Log display */}
        {logMessages.length > 0 && (
          <div className="border rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <Info className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-medium">Import Log</h3>
            </div>
            <div className="bg-muted rounded-md p-3 text-xs font-mono h-40 overflow-y-auto">
              {logMessages.map((message, index) => (
                <div key={index} className="mb-1">{message}</div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
} 