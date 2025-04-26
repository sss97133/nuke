import { useState, useEffect, useRef } from 'react';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CaptureIntegrationService, ProcessResult, VehicleCapture } from '@/services/CaptureIntegrationService';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, CheckCircle, XCircle, RefreshCw, Upload, FileJson, FileCode, Shield } from 'lucide-react';
import { formatDistance } from 'date-fns';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export default function CaptureIntegration() {
  const { toast } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [processingResults, setProcessingResults] = useState<ProcessResult[]>([]);
  const [pendingCaptures, setPendingCaptures] = useState<any[]>([]);
  const [processedCaptures, setProcessedCaptures] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    pending: 0,
    processed: 0,
    vehicles: 0,
  });
  const [importData, setImportData] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load capture statistics and captures
  const loadCaptures = async () => {
    try {
      setLoading(true);

      if (!supabase) {
        toast({
          title: 'Error',
          description: 'Database connection not available',
          variant: 'destructive',
        });
        return;
      }

      // Get capture counts
      const { count: pendingCount } = await supabase
        .from('captured_vehicles')
        .select('*', { count: 'exact', head: true })
        .eq('processed', false);

      const { count: processedCount } = await supabase
        .from('captured_vehicles')
        .select('*', { count: 'exact', head: true })
        .eq('processed', true);

      const { count: vehicleCount } = await supabase
        .from('vehicles')
        .select('*', { count: 'exact', head: true });

      setStats({
        pending: pendingCount || 0,
        processed: processedCount || 0,
        vehicles: vehicleCount || 0,
      });

      // Get pending captures
      const { data: pending } = await supabase
        .from('captured_vehicles')
        .select('*, vehicles(id, make, model, year)')
        .eq('processed', false)
        .order('created_at', { ascending: false })
        .limit(10);

      if (pending) {
        setPendingCaptures(pending);
      }

      // Get recently processed captures
      const { data: processed } = await supabase
        .from('captured_vehicles')
        .select('*, vehicles(id, make, model, year)')
        .eq('processed', true)
        .order('processed_at', { ascending: false })
        .limit(10);

      if (processed) {
        setProcessedCaptures(processed);
      }
    } catch (error) {
      console.error('Error loading captures:', error);
      toast({
        title: 'Error',
        description: 'Failed to load capture data',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCaptures();
  }, []);

  // Handle file selection
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      setSelectedFile(files[0]);
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          setImportData(event.target.result as string);
        }
      };
      reader.readAsText(files[0]);
    }
  };

  // Import data from JSON
  const importCapturesFromJson = async () => {
    try {
      setIsImporting(true);
      setProcessingResults([]);

      if (!importData) {
        toast({
          title: 'Error',
          description: 'No import data provided',
          variant: 'destructive',
        });
        setIsImporting(false);
        return;
      }

      let captureData: Partial<VehicleCapture>[];
      try {
        captureData = JSON.parse(importData);
        if (!Array.isArray(captureData)) {
          captureData = [captureData]; // Convert single object to array
        }
      } catch (error) {
        toast({
          title: 'Invalid JSON',
          description: 'The provided data is not valid JSON',
          variant: 'destructive',
        });
        setIsImporting(false);
        return;
      }

      // Process the import
      const result = await CaptureIntegrationService.importCapturesFromExtension(captureData);
      
      setProcessingResults(result.results);

      toast({
        title: 'Import Complete',
        description: `Imported ${result.imported} captures (${result.failed} failed)`,
        variant: result.failed === 0 ? 'default' : 'destructive',
      });

      if (result.imported > 0) {
        // Clear form data on successful import
        setImportData('');
        setSelectedFile(null);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }

      // Reload the data
      await loadCaptures();
    } catch (error) {
      console.error('Error importing captures:', error);
      toast({
        title: 'Error',
        description: 'Failed to import captures',
        variant: 'destructive',
      });
    } finally {
      setIsImporting(false);
    }
  };

  // Process all pending captures
  const processAllCaptures = async () => {
    try {
      setIsProcessing(true);
      setProcessingResults([]);

      const result = await CaptureIntegrationService.processAllPendingCaptures();

      setProcessingResults(result.results);

      toast({
        title: 'Processing Complete',
        description: `Processed ${result.processed} captures (${result.failed} failed)`,
        variant: result.failed === 0 ? 'default' : 'destructive',
      });

      // Reload the data
      await loadCaptures();
    } catch (error) {
      console.error('Error processing captures:', error);
      toast({
        title: 'Error',
        description: 'Failed to process captures',
        variant: 'destructive',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // Process a single capture
  const processSingleCapture = async (captureId: string) => {
    try {
      setIsProcessing(true);

      const result = await CaptureIntegrationService.processCapture(captureId);

      if (result.success) {
        toast({
          title: 'Capture Processed',
          description: result.message,
        });
      } else {
        toast({
          title: 'Processing Failed',
          description: result.message,
          variant: 'destructive',
        });
      }

      // Reload the data
      await loadCaptures();
    } catch (error) {
      console.error('Error processing capture:', error);
      toast({
        title: 'Error',
        description: 'Failed to process capture',
        variant: 'destructive',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const formatTimeAgo = (dateString: string) => {
    try {
      return formatDistance(new Date(dateString), new Date(), { addSuffix: true });
    } catch (e) {
      return dateString;
    }
  };

  return (
    <div className="container mx-auto py-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Capture Integration</h1>
        <Button 
          variant="outline" 
          onClick={loadCaptures}
          className="flex items-center"
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh Data
        </Button>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <Card>
          <CardHeader>
            <CardTitle>Pending Captures</CardTitle>
            <CardDescription>Captures waiting to be processed</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold">{stats.pending}</div>
          </CardContent>
          <CardFooter>
            <Button 
              onClick={processAllCaptures} 
              disabled={isProcessing || stats.pending === 0}
              className="flex items-center w-full"
              size="sm"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  Process All Pending
                </>
              )}
            </Button>
          </CardFooter>
        </Card>
        
        <Card>
          <CardHeader>
            <CardTitle>Processed Captures</CardTitle>
            <CardDescription>Captures already added to vehicles</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold">{stats.processed}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader>
            <CardTitle>Total Vehicles</CardTitle>
            <CardDescription>Vehicles in the database</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold">{stats.vehicles}</div>
          </CardContent>
        </Card>
      </div>
      
      <Tabs defaultValue="pending">
        <TabsList className="mb-4">
          <TabsTrigger value="pending">Pending Captures</TabsTrigger>
          <TabsTrigger value="processed">Processed Captures</TabsTrigger>
          <TabsTrigger value="import">Import Captures</TabsTrigger>
          <TabsTrigger value="docs">Developer Guide</TabsTrigger>
          {processingResults.length > 0 && (
            <TabsTrigger value="results">Processing Results</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="pending">
          {pendingCaptures.length === 0 ? (
            <Card>
              <CardContent className="pt-6">
                <p className="text-center text-muted-foreground">No pending captures found.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {pendingCaptures.map((capture) => (
                <Card key={capture.id}>
                  <CardHeader className="pb-2">
                    <div className="flex justify-between">
                      <CardTitle>{capture.year} {capture.make} {capture.model}</CardTitle>
                      <span className="text-muted-foreground text-sm">
                        {formatTimeAgo(capture.created_at)}
                      </span>
                    </div>
                    <CardDescription>VIN: {capture.vin}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p>Source: {capture.source}</p>
                        <p>Price: {capture.price ? `$${capture.price.toLocaleString()}` : 'N/A'}</p>
                      </div>
                      <div>
                        <p>Color: {capture.color || 'N/A'}</p>
                        <p>Trim: {capture.trim || 'N/A'}</p>
                      </div>
                    </div>
                  </CardContent>
                  <CardFooter className="flex justify-end">
                    <Button
                      onClick={() => processSingleCapture(capture.id)}
                      disabled={isProcessing}
                      size="sm"
                    >
                      {isProcessing ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        'Process This Capture'
                      )}
                    </Button>
                  </CardFooter>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="processed">
          {processedCaptures.length === 0 ? (
            <Card>
              <CardContent className="pt-6">
                <p className="text-center text-muted-foreground">No processed captures found.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {processedCaptures.map((capture) => (
                <Card key={capture.id}>
                  <CardHeader className="pb-2">
                    <div className="flex justify-between">
                      <CardTitle>{capture.year} {capture.make} {capture.model}</CardTitle>
                      <span className="text-muted-foreground text-sm">
                        Processed {formatTimeAgo(capture.processed_at)}
                      </span>
                    </div>
                    <CardDescription className="flex items-center">
                      <span>VIN: {capture.vin}</span>
                      {capture.vehicle_id && (
                        <Button
                          variant="link"
                          className="h-auto p-0 ml-2"
                          onClick={() => window.open(`/vehicles/${capture.vehicle_id}`, '_blank')}
                        >
                          View Vehicle
                        </Button>
                      )}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p>Source: {capture.source}</p>
                        <p>Captured: {formatTimeAgo(capture.created_at)}</p>
                      </div>
                      <div>
                        <p>Vehicle ID: {capture.vehicle_id || 'N/A'}</p>
                        <p>Status: {capture.vehicles ? 'Linked to Vehicle' : 'Processing Error'}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="import">
          <Card>
            <CardHeader>
              <CardTitle>Import Captures from Chrome Extension</CardTitle>
              <CardDescription>Upload JSON data from the extension or paste it directly</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex flex-col space-y-2">
                  <label htmlFor="file-upload" className="text-sm font-medium">
                    Upload JSON File
                  </label>
                  <div className="flex items-center space-x-2">
                    <Input
                      id="file-upload"
                      type="file"
                      accept=".json"
                      onChange={handleFileSelect}
                      ref={fileInputRef}
                      className="flex-1"
                    />
                    {selectedFile && (
                      <div className="text-sm text-muted-foreground">
                        {selectedFile.name} ({Math.round(selectedFile.size / 1024)} KB)
                      </div>
                    )}
                  </div>
                </div>
                
                <div className="flex flex-col space-y-2">
                  <label htmlFor="json-data" className="text-sm font-medium">
                    Or Paste JSON Data
                  </label>
                  <Textarea
                    id="json-data"
                    placeholder={`[
  {
    "make": "Toyota",
    "model": "Supra",
    "year": 1994,
    "vin": "JT2MA70L3K0123456",
    "color": "Red",
    "price": 45000,
    "source": "bring_a_trailer"
  }
]`}
                    value={importData}
                    onChange={(e) => setImportData(e.target.value)}
                    rows={10}
                  />
                </div>
                
                <Alert>
                  <FileCode className="h-4 w-4" />
                  <AlertTitle>JSON Format</AlertTitle>
                  <AlertDescription>
                    The JSON should be an array of objects with properties: make, model, year, vin (required);
                    color, trim, price, image_url, capture_url, source (optional).
                  </AlertDescription>
                </Alert>
              </div>
            </CardContent>
            <CardFooter>
              <Button
                onClick={importCapturesFromJson}
                disabled={isImporting || (!importData && !selectedFile)}
                className="flex items-center w-full"
              >
                {isImporting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Importing Captures...
                  </>
                ) : (
                  <>
                    <Upload className="mr-2 h-4 w-4" />
                    Import Captures
                  </>
                )}
              </Button>
            </CardFooter>
          </Card>
        </TabsContent>

        <TabsContent value="docs">
          <Card>
            <CardHeader>
              <CardTitle>Chrome Extension Developer Guide</CardTitle>
              <CardDescription>How to integrate with the Nuke vehicle capture system</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <h3 className="text-lg font-medium">Overview</h3>
                <p>The Chrome extension can capture vehicle information from various sources and send it to the Nuke platform, where it becomes part of the vehicle's digital identity.</p>
              </div>

              <div className="space-y-2">
                <h3 className="text-lg font-medium">Data Format</h3>
                <p>The extension should collect the following data for each vehicle capture:</p>
                <div className="bg-muted p-3 rounded-md font-mono text-sm mt-2">
{`{
  // Required fields
  "make": "Porsche",      // Vehicle manufacturer
  "model": "911",         // Vehicle model
  "year": 1995,           // Model year (number)
  "vin": "WP0AA2991SS320055", // 17-character VIN

  // Optional fields
  "color": "Guards Red",  // Exterior color
  "trim": "Carrera",      // Trim level
  "price": 98500,         // Asking price (number)
  "image_url": "https://...jpg", // Primary image URL
  "capture_url": "https://...", // Source listing URL
  "source": "bring_a_trailer", // Source site identifier
  "metadata": {           // Additional data
    "mileage": 62500,
    "engine": "3.6L Flat-6",
    "transmission": "Manual"
  }
}`}
                </div>
              </div>

              <div className="space-y-2">
                <h3 className="text-lg font-medium">Integration Options</h3>
                <p>There are two ways to send data to the Nuke platform:</p>
                <ol className="list-decimal pl-6 space-y-2">
                  <li><strong>API Endpoint:</strong> POST to <code>/api/capture</code> with the vehicle data</li>
                  <li><strong>Manual Import:</strong> Export captures as JSON and upload via this interface</li>
                </ol>
              </div>

              <div className="space-y-2">
                <h3 className="text-lg font-medium">API Endpoint</h3>
                <p>To send captures directly from the extension:</p>
                <div className="bg-muted p-3 rounded-md font-mono text-sm mt-2 overflow-x-auto">
{`// Example API call
fetch('https://nuke-platform.example.com/api/capture', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_API_KEY'
  },
  body: JSON.stringify(vehicleData)
});
`}
                </div>
              </div>

              <div className="space-y-2">
                <h3 className="text-lg font-medium">VIN Validation</h3>
                <p>The system validates VINs before processing:</p>
                <ul className="list-disc pl-6 space-y-1">
                  <li>Must be exactly 17 characters</li>
                  <li>Cannot contain I, O, or Q (commonly confused with 1 and 0)</li>
                  <li>Must contain only alphanumeric characters</li>
                </ul>
              </div>

              <Alert>
                <Shield className="h-4 w-4" />
                <AlertTitle>Authentication</AlertTitle>
                <AlertDescription>
                  For production use, contact the platform administrator to obtain API credentials. This ensures proper authentication and data attribution for your extension's captures.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        </TabsContent>

        {processingResults.length > 0 && (
          <TabsContent value="results">
            <div className="space-y-4">
              {processingResults.map((result, index) => (
                <Card key={index}>
                  <CardHeader className="pb-2">
                    <div className="flex justify-between items-center">
                      <CardTitle className="flex items-center">
                        {result.success ? (
                          <CheckCircle className="h-5 w-5 text-green-500 mr-2" />
                        ) : (
                          <XCircle className="h-5 w-5 text-red-500 mr-2" />
                        )}
                        {result.success ? 'Success' : 'Failed'}
                      </CardTitle>
                      {result.vin && (
                        <span className="text-sm text-muted-foreground">VIN: {result.vin}</span>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p>{result.message}</p>
                    {result.vehicleId && (
                      <Button
                        variant="link"
                        className="h-auto p-0 mt-2"
                        onClick={() => window.open(`/vehicles/${result.vehicleId}`, '_blank')}
                      >
                        View Vehicle
                      </Button>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
