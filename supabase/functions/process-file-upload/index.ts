/**
 * Process File Upload
 *
 * Universal file upload processor for the Import Data page.
 * Handles: images, PDFs, spreadsheets (CSV, XLSX, Numbers), and documents.
 * Routes to appropriate extraction pipeline based on file type.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface FileClassification {
  category: 'image' | 'pdf' | 'spreadsheet' | 'document' | 'unknown';
  mimeType: string;
  extension: string;
  processingHint: string;
}

interface ProcessedResult {
  success: boolean;
  fileId: string;
  category: string;
  extractedData?: any;
  queuedForProcessing?: boolean;
  message: string;
  storagePath?: string;
  publicUrl?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get user from JWT
    const authHeader = req.headers.get("Authorization");
    let userId: string | null = null;

    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.replace("Bearer ", "");
      const { data: { user }, error } = await supabase.auth.getUser(token);
      if (user && !error) {
        userId = user.id;
      }
    }

    if (!userId) {
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse multipart form data
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const vehicleId = formData.get("vehicle_id") as string | null;
    const processImmediately = formData.get("process_immediately") === "true";

    if (!file) {
      return new Response(
        JSON.stringify({ error: "No file provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Classify the file
    const classification = classifyFile(file);
    console.log(`Processing ${classification.category} file: ${file.name}`);

    // Generate unique storage path
    const timestamp = Date.now();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `imports/${userId}/${timestamp}_${safeName}`;

    // Upload to storage
    const fileBuffer = await file.arrayBuffer();
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("vehicle-images")
      .upload(storagePath, fileBuffer, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });

    if (uploadError) {
      console.error("Storage upload error:", uploadError);
      return new Response(
        JSON.stringify({ error: "Failed to upload file", details: uploadError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from("vehicle-images")
      .getPublicUrl(storagePath);
    const publicUrl = urlData.publicUrl;

    // Create import queue record
    const { data: queueRecord, error: queueError } = await supabase
      .from("import_queue")
      .insert({
        user_id: userId,
        source_url: publicUrl,
        source_type: `file:${classification.category}`,
        raw_data: {
          filename: file.name,
          mimeType: classification.mimeType,
          size: file.size,
          storagePath,
          classification,
        },
        vehicle_id: vehicleId,
        status: "pending",
        priority: classification.category === 'spreadsheet' ? 1 : 2, // Spreadsheets higher priority
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (queueError) {
      console.error("Queue insert error:", queueError);
    }

    let result: ProcessedResult = {
      success: true,
      fileId: queueRecord?.id || `upload_${timestamp}`,
      category: classification.category,
      queuedForProcessing: true,
      message: `File uploaded and queued for ${classification.processingHint}`,
      storagePath,
      publicUrl,
    };

    // Process immediately if requested and file is small enough
    if (processImmediately && file.size < 10 * 1024 * 1024) { // < 10MB
      try {
        const extractedData = await processFileByType(
          supabase,
          file,
          fileBuffer,
          classification,
          userId,
          vehicleId
        );

        if (extractedData) {
          result.extractedData = extractedData;
          result.message = `File processed successfully. Found ${extractedData.vehicleCount || 0} vehicle(s).`;

          // Update queue record with extracted data
          if (queueRecord?.id) {
            await supabase
              .from("import_queue")
              .update({
                status: "processed",
                extracted_data: extractedData,
                processed_at: new Date().toISOString(),
              })
              .eq("id", queueRecord.id);
          }
        }
      } catch (processError: any) {
        console.error("Processing error:", processError);
        result.message = `File uploaded but processing failed: ${processError.message}. Will retry in background.`;
      }
    }

    return new Response(
      JSON.stringify(result),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("File upload error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

/**
 * Classify file by type
 */
function classifyFile(file: File): FileClassification {
  const mimeType = file.type.toLowerCase();
  const extension = file.name.split('.').pop()?.toLowerCase() || '';

  // Images
  if (mimeType.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif'].includes(extension)) {
    return {
      category: 'image',
      mimeType,
      extension,
      processingHint: 'image analysis and vehicle detection',
    };
  }

  // PDFs
  if (mimeType === 'application/pdf' || extension === 'pdf') {
    return {
      category: 'pdf',
      mimeType: 'application/pdf',
      extension: 'pdf',
      processingHint: 'PDF text extraction and vehicle data parsing',
    };
  }

  // Spreadsheets
  if (
    mimeType === 'text/csv' ||
    mimeType === 'application/vnd.ms-excel' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mimeType === 'application/vnd.apple.numbers' ||
    ['csv', 'xlsx', 'xls', 'numbers'].includes(extension)
  ) {
    return {
      category: 'spreadsheet',
      mimeType,
      extension,
      processingHint: 'spreadsheet parsing and vehicle data extraction',
    };
  }

  // Documents (Word, etc.)
  if (
    mimeType === 'application/msword' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    ['doc', 'docx', 'rtf', 'txt'].includes(extension)
  ) {
    return {
      category: 'document',
      mimeType,
      extension,
      processingHint: 'document text extraction',
    };
  }

  return {
    category: 'unknown',
    mimeType,
    extension,
    processingHint: 'manual review required',
  };
}

/**
 * Process file based on type
 */
async function processFileByType(
  supabase: any,
  file: File,
  buffer: ArrayBuffer,
  classification: FileClassification,
  userId: string,
  vehicleId: string | null
): Promise<any> {
  switch (classification.category) {
    case 'spreadsheet':
      return await processSpreadsheet(supabase, file, buffer, userId, vehicleId);
    case 'csv':
      return await processCsv(new TextDecoder().decode(buffer), userId, vehicleId);
    case 'pdf':
      // PDF processing would call extract-pdf-text then extract-vehicle-data-ai
      return { type: 'pdf', message: 'PDF queued for OCR and extraction' };
    case 'image':
      // Image processing handled by nuke-box-upload
      return { type: 'image', message: 'Image queued for analysis' };
    default:
      return null;
  }
}

/**
 * Process spreadsheet (CSV, XLSX, Numbers)
 */
async function processSpreadsheet(
  supabase: any,
  file: File,
  buffer: ArrayBuffer,
  userId: string,
  vehicleId: string | null
): Promise<any> {
  const extension = file.name.split('.').pop()?.toLowerCase();

  // For CSV, parse directly
  if (extension === 'csv') {
    const text = new TextDecoder().decode(buffer);
    return processCsv(text, userId, vehicleId);
  }

  // For XLSX/Numbers, we need a more complex parser
  // For now, queue for background processing with AI
  return {
    type: 'spreadsheet',
    extension,
    message: 'Spreadsheet queued for AI-powered extraction',
    requiresAiProcessing: true,
  };
}

/**
 * Process CSV file
 */
function processCsv(csvText: string, userId: string, vehicleId: string | null): any {
  const lines = csvText.split('\n').filter(line => line.trim());
  if (lines.length < 2) {
    return { error: 'CSV appears empty', vehicleCount: 0 };
  }

  // Parse header row
  const headers = parseCSVRow(lines[0]).map(h => h.toLowerCase().trim());

  // Map common header variations to standard fields
  const fieldMap: Record<string, string[]> = {
    year: ['year', 'model year', 'yr'],
    make: ['make', 'manufacturer', 'brand'],
    model: ['model', 'model name'],
    vin: ['vin', 'vehicle identification number', 'vin number'],
    mileage: ['mileage', 'miles', 'odometer', 'odo'],
    price: ['price', 'asking price', 'sale price', 'cost'],
    color: ['color', 'exterior color', 'ext color', 'paint'],
    interior_color: ['interior', 'interior color', 'int color'],
    transmission: ['transmission', 'trans', 'gearbox'],
    engine: ['engine', 'motor', 'engine type'],
    description: ['description', 'notes', 'comments', 'details'],
    location: ['location', 'city', 'state', 'address'],
  };

  // Find column indices
  const columnIndices: Record<string, number> = {};
  for (const [field, variations] of Object.entries(fieldMap)) {
    const index = headers.findIndex(h => variations.some(v => h.includes(v)));
    if (index !== -1) {
      columnIndices[field] = index;
    }
  }

  // Parse data rows
  const vehicles = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVRow(lines[i]);
    if (values.length === 0) continue;

    const vehicle: Record<string, any> = {};
    for (const [field, index] of Object.entries(columnIndices)) {
      if (values[index]) {
        vehicle[field] = values[index].trim();
      }
    }

    // Only include if we have at least year, make, or model
    if (vehicle.year || vehicle.make || vehicle.model || vehicle.vin) {
      // Normalize values
      if (vehicle.year) vehicle.year = parseInt(vehicle.year);
      if (vehicle.mileage) vehicle.mileage = parseInt(vehicle.mileage.replace(/[^0-9]/g, ''));
      if (vehicle.price) vehicle.price = parseInt(vehicle.price.replace(/[^0-9]/g, ''));

      vehicles.push(vehicle);
    }
  }

  return {
    type: 'csv',
    vehicleCount: vehicles.length,
    vehicles,
    detectedColumns: Object.keys(columnIndices),
    totalRows: lines.length - 1,
  };
}

/**
 * Parse a single CSV row, handling quoted fields
 */
function parseCSVRow(row: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < row.length; i++) {
    const char = row[i];

    if (char === '"') {
      if (inQuotes && row[i + 1] === '"') {
        current += '"';
        i++; // Skip the escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current); // Don't forget the last field
  return result;
}
