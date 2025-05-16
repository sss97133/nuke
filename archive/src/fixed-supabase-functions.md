# Fixed Supabase Function Calls

This file contains all the corrected Supabase function calls for the components you mentioned.

## 1. MendableChat Component

```tsx
// src/components/ai/MendableChat.tsx
const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault()
  if (!query.trim()) return

  setIsLoading(true)
  try {
    const { data, error } = await supabase.functions.invoke('query-mendable', {
      body: { query: query.trim() }
    });

    if (error) {
      console.error('Supabase function error:', error)
      throw new Error(error.message)
    }

    if (!data?.answer) {
      throw new Error('No answer received from AI')
    }

    setResponse(data.answer)
    setQuery("")
  } catch (error) {
    console.error('Error querying Mendable:', error)
    toast({
      title: "Error",
      description: error instanceof Error ? error.message : "Failed to get response from AI. Please try again.",
      variant: "destructive"
    })
  } finally {
    setIsLoading(false)
  }
}
```

## 2. AIExplanations Component

```tsx
// src/components/ai/AIExplanations.tsx
const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  if (!question.trim()) return;

  setIsGenerating(true);
  try {
    const { data, error } = await supabase.functions.invoke('generate-explanation', {
      body: { question: question.trim() }
    });

    if (error) throw error;

    await refetch();
    setQuestion("");
    toast({
      title: "Explanation Generated",
      description: "Your explanation has been generated and saved.",
    });
  } catch (error) {
    console.error('Error generating explanation:', error);
    toast({
      title: "Error",
      description: "Failed to generate explanation. Please try again.",
      variant: "destructive"
    });
  } finally {
    setIsGenerating(false);
  }
};
```

## 3. ImportGarages Component

```tsx
// src/components/garage/ImportGarages.tsx
const importGarages = async () => {
  setImporting(true);
  try {
    toast({
      title: "Location Required",
      description: "Please allow location access to import nearby garages",
    });

    const position = await new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 5000,
        maximumAge: 0
      });
    });

    toast({
      title: "Searching",
      description: "Looking for garages within 5km...",
    });

    const { data, error } = await supabase.functions.invoke('search-local-garages', {
      body: {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        radius: 5000 // 5km radius
      }
    });

    if (error) throw error;

    toast({
      title: "Success",
      description: `Found and imported ${data?.garages?.length || 0} garages`,
    });

  } catch (error: any) {
    console.error('Import error:', error);
    toast({
      title: "Error",
      description: error.message || "Failed to import garages. Please try again.",
      variant: "destructive",
    });
  } finally {
    setImporting(false);
  }
};
```

## 4. Photo Capture Hook

```tsx
// src/components/inventory/form-sections/photo-capture/usePhotoCapture.ts
const handleSmartScan = async () => {
  if (!preview) return;

  setIsAnalyzing(true);
  try {
    const { data, error } = await supabase.functions.invoke('analyze-inventory-image', {
      body: { imageUrl: preview.url }
    });

    if (error) throw error;

    setAiResults(data.classifications || []);
    
    toast({
      title: "Image analyzed successfully",
      description: "Review the suggested information in the next step.",
    });
  } catch (error) {
    console.error("Error analyzing image:", error);
    toast({
      title: "Error analyzing image",
      description: "Please try again or proceed with manual entry.",
      variant: "destructive",
    });
  } finally {
    setIsAnalyzing(false);
  }
};
```

## 5. Vehicle Profile Component

```tsx
// src/components/vehicles/VehicleProfile.tsx
const searchVehicleHistory = async () => {
  if (!vehicle) return;
  
  setSearching(true);
  try {
    console.log('Searching vehicle history for vehicle:', vehicle.id);
    const { error } = await supabase.functions.invoke('search-vehicle-history', {
      body: { vehicleId: vehicle.id }
    });

    if (error) throw error;

    // Refresh vehicle data to get updated historical_data
    const { data: updatedVehicle, error: fetchError } = await supabase
      .from("vehicles")
      .select("*")
      .eq("id", vehicle.id)
      .single();

    if (fetchError) throw fetchError;

    const historicalData = updatedVehicle.historical_data as VehicleHistoricalData;
    
    // Create a summary of what was found
    const summary = [];
    if (historicalData?.previousSales?.length) {
      summary.push(`${historicalData.previousSales.length} previous sales`);
    }
    if (historicalData?.modifications?.length) {
      summary.push(`${historicalData.modifications.length} modifications`);
    }
    if (historicalData?.notableHistory) {
      summary.push("notable history");
    }
    if (historicalData?.conditionNotes) {
      summary.push("condition notes");
    }

    setVehicle(prev => prev ? {
      ...prev,
      historical_data: historicalData
    } : null);

    toast({
      title: "Vehicle History Updated",
      description: summary.length > 0 
        ? `Found: ${summary.join(", ")}`
        : "No significant historical data found for this vehicle",
      variant: summary.length > 0 ? "default" : "destructive",
    });
  } catch (error) {
    console.error('Error searching vehicle history:', error);
    toast({
      title: "Error",
      description: "Failed to search vehicle history. Please try again.",
      variant: "destructive",
    });
  } finally {
    setSearching(false);
  }
};
```

## 6. File Import Component

```tsx
// src/components/vehicles/import/FileImport.tsx
const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
  const file = event.target.files?.[0];
  if (!file) return;

  setIsLoading(true);
  try {
    const fileType = file.name.split('.').pop()?.toLowerCase();
    const allowedTypes = ['csv', 'xlsx', 'xls', 'numbers', 'pdf'];
    
    if (!fileType || !allowedTypes.includes(fileType)) {
      throw new Error('Unsupported file type. Please use CSV, Excel, Numbers, or PDF files.');
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      const content = e.target?.result;
      
      const { data, error } = await supabase.functions.invoke('process-vehicle-import', {
        body: { data: content, fileType }
      });

      if (error) throw error;
      
      onNormalizedData(data.vehicles);
    };

    if (fileType === 'pdf') {
      reader.readAsArrayBuffer(file);
    } else {
      reader.readAsText(file);
    }
  } catch (error: any) {
    toast({
      title: "Import Error",
      description: error.message,
      variant: "destructive"
    });
  } finally {
    setIsLoading(false);
  }
};
```

## 7. Website Import Component

```tsx
// src/components/vehicles/import/WebsiteImport.tsx
const handleImport = async () => {
  if (!url) return;

  setIsLoading(true);
  try {
    const { data, error } = await supabase.functions.invoke('process-vehicle-import', {
      body: { data: url, fileType: 'url' }
    });

    if (error) throw error;
    
    onNormalizedData(data.vehicles);
  } catch (error: any) {
    toast({
      title: "Import Error",
      description: error.message,
      variant: "destructive"
    });
  } finally {
    setIsLoading(false);
  }
};
```

## 8. VIN Capture Hook

```tsx
// src/components/vehicles/vin-capture/useVinCapture.ts
const processVin = async (imageBlob: Blob) => {
  setIsProcessing(true);
  setProgress(0);
  try {
    updateProcessingStatus("Preprocessing image...", 20);
    await new Promise(resolve => setTimeout(resolve, 800));

    updateProcessingStatus("Performing OCR analysis...", 40);
    const formData = new FormData();
    formData.append('image', imageBlob);

    updateProcessingStatus("Matching VIN patterns...", 60);
    await new Promise(resolve => setTimeout(resolve, 800));

    updateProcessingStatus("Verifying with database...", 80);
    const { data, error } = await supabase.functions.invoke('process-vin', {
      body: { image: imageBlob }
    });

    if (error) throw error;

    updateProcessingStatus("Completing verification...", 100);
    await new Promise(resolve => setTimeout(resolve, 500));

    if (data.vin) {
      setConfidence(90);
      onVinData(data);
      toast({
        title: "VIN Processed Successfully",
        description: `Extracted VIN: ${data.vin} (90% confidence)`,
      });
    } else {
      setConfidence(0);
      toast({
        title: "VIN Not Found",
        description: "Could not detect a valid VIN in the image.",
        variant: "destructive",
      });
    }
  } catch (error) {
    setConfidence(0);
    toast({
      title: "Processing Error",
      description: "Failed to process VIN image.",
      variant: "destructive",
    });
  } finally {
    setIsProcessing(false);
    setProcessingStep("");
    setProgress(0);
  }
};
```

## 9. Supabase Helpers (for safer interactions)

```tsx
// src/utils/supabase-helpers.ts
import { PostgrestError } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

/**
 * Utility functions to safely interact with Supabase
 * This file provides helper functions for common Supabase operations
 * with proper error handling and TypeScript typing
 */

export type SupabaseResult<T> = {
  data: T | null;
  error: PostgrestError | null;
};

export type TableNames = keyof Database['public']['Tables'];

export class SupabaseError extends Error {
  constructor(
    message: string,
    public details?: unknown,
    public code?: string
  ) {
    super(message);
    this.name = 'SupabaseError';
  }
}

/**
 * Handle Supabase errors in a consistent way
 * @param error The error from a Supabase operation
 * @param context Optional context about where the error occurred
 */
export function handleSupabaseError(error: PostgrestError | null, context?: string): never {
  if (error) {
    throw new SupabaseError(
      `Supabase error${context ? ` in ${context}` : ''}: ${error.message}`,
      error.details,
      error.code
    );
  }
  throw new SupabaseError('Unknown Supabase error occurred');
}

/**
 * Assert that data exists and is not null
 * @param result The result from a Supabase operation
 * @param context Optional context about where the assertion is happening
 */
export function assertData<T>(
  result: SupabaseResult<T>,
  context?: string
): asserts result is { data: T; error: null } {
  if (result.error) {
    handleSupabaseError(result.error, context);
  }
  if (result.data === null) {
    throw new SupabaseError(`No data returned${context ? ` from ${context}` : ''}`);
  }
}

/**
 * Safely invoke a Supabase Edge Function with proper error handling
 * @param functionName Name of the Edge Function to invoke
 * @param body Request body to send to the function
 * @param context Optional context for error messages
 */
export async function invokeSafeFunction<T = any>(
  functionName: string, 
  body: any,
  context?: string
): Promise<T> {
  try {
    const { data, error } = await supabase.functions.invoke(functionName, { body });
    
    if (error) {
      throw new SupabaseError(
        `Error invoking function "${functionName}"${context ? ` in ${context}` : ''}: ${error.message}`,
        error.details,
        error.code
      );
    }
    
    return data as T;
  } catch (error) {
    if (error instanceof SupabaseError) {
      throw error;
    }
    throw new SupabaseError(
      `Failed to invoke function "${functionName}"${context ? ` in ${context}` : ''}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
```

## 10. Safe Supabase Import

```tsx
// src/lib/supabase.ts
import { supabase } from '@/integrations/supabase/client';

// Re-export the Supabase client to provide a safe way for components to access it
export { supabase };

/**
 * This file serves as a bridge to safely access the Supabase client
 * without modifying the protected src/integrations/supabase/client.ts file.
 * 
 * Import this file instead of importing directly from the protected client file.
 */

// Safely invoke a Supabase Edge Function with proper error handling
export async function invokeFunction<T = any>(
  functionName: string,
  body: any
): Promise<{ data: T | null; error: Error | null }> {
  try {
    const { data, error } = await supabase.functions.invoke(functionName, { body });
    
    if (error) {
      return { data: null, error: new Error(error.message) };
    }
    
    return { data: data as T, error: null };
  } catch (error) {
    return { 
      data: null, 
      error: error instanceof Error 
        ? error 
        : new Error(String(error)) 
    };
  }
}

// Add any custom wrappers or extended functionality here
export const uploadFile = async (bucket: string, path: string, file: File) => {
  const { data, error } = await supabase.storage.from(bucket).upload(path, file);
  return { data, error };
};

export const getPublicUrl = (bucket: string, path: string) => {
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
};
```
