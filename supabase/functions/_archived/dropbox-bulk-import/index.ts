/**
 * Dropbox Bulk Import for Dealers
 * Scans Dropbox folder structure and imports deal jackets
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');

interface DealJacketFolder {
  path: string;
  name: string;
  files: {
    pdfs: Array<{ name: string; path: string; url: string }>;
    images: Array<{ name: string; path: string; url: string }>;
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { organizationId, dropboxPath = '/Viva Inventory' } = await req.json();

    console.log(`📁 Starting bulk import for ${organizationId} from ${dropboxPath}`);

    // Get Dropbox connection
    const { data: connection } = await supabase
      .from('dropbox_connections')
      .select('access_token, refresh_token')
      .eq('organization_id', organizationId)
      .single();

    if (!connection) {
      throw new Error('No Dropbox connection found. Please authorize Dropbox first.');
    }

    // Create import job
    const { data: job } = await supabase
      .from('dropbox_import_jobs')
      .insert({
        organization_id: organizationId,
        dropbox_path: dropboxPath,
        status: 'processing',
        started_at: new Date().toISOString()
      })
      .select('id')
      .single();

    const jobId = job!.id;

    // List all folders in Dropbox path
    const listResponse = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        path: dropboxPath === '/' ? '' : dropboxPath,
        recursive: true
      })
    });

    if (!listResponse.ok) {
      throw new Error(`Dropbox API error: ${listResponse.status}`);
    }

    const listData = await listResponse.json();
    const entries = listData.entries;

    // Group files by parent folder (each folder = one vehicle deal jacket)
    const dealJackets = new Map<string, DealJacketFolder>();

    for (const entry of entries) {
      if (entry['.tag'] === 'file') {
        const pathParts = entry.path_lower.split('/');
        const folderPath = pathParts.slice(0, -1).join('/');
        const folderName = pathParts[pathParts.length - 2];
        const fileName = entry.name.toLowerCase();

        if (!dealJackets.has(folderPath)) {
          dealJackets.set(folderPath, {
            path: folderPath,
            name: folderName,
            files: { pdfs: [], images: [] }
          });
        }

        const jacket = dealJackets.get(folderPath)!;

        // Get temporary download link
        const linkResponse = await fetch('https://api.dropboxapi.com/2/files/get_temporary_link', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${connection.access_token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ path: entry.path_lower })
        });

        if (linkResponse.ok) {
          const linkData = await linkResponse.json();
          const fileObj = { name: entry.name, path: entry.path_lower, url: linkData.link };

          if (fileName.endsWith('.pdf')) {
            jacket.files.pdfs.push(fileObj);
          } else if (fileName.match(/\.(jpg|jpeg|png|heic)$/)) {
            jacket.files.images.push(fileObj);
          }
        }
      }
    }

    console.log(`📦 Found ${dealJackets.size} deal jacket folders`);

    // Update job with total count
    await supabase
      .from('dropbox_import_jobs')
      .update({ total_files: dealJackets.size })
      .eq('id', jobId);

    let processedCount = 0;
    let vehiclesCreated = 0;

    // Process each deal jacket
    for (const [path, jacket] of dealJackets) {
      try {
        console.log(`\n🚗 Processing: ${jacket.name}`);
        
        // Parse folder name to extract vehicle info
        // Format: "1977 K5 Blazer - #VIN123" or "1974 Bronco"
        const vehicleInfo = parseFolderName(jacket.name);
        
        if (!vehicleInfo.year || !vehicleInfo.make || !vehicleInfo.model) {
          console.log(`  ⏭ Skipping ${jacket.name} - couldn't parse vehicle info`);
          continue;
        }

        // Check if vehicle exists by VIN (if provided)
        let vehicleId = null;
        
        if (vehicleInfo.vin) {
          const { data: existing } = await supabase
            .from('vehicles')
            .select('id')
            .eq('vin', vehicleInfo.vin)
            .single();
          
          vehicleId = existing?.id;
        }

        // Create vehicle if doesn't exist
        if (!vehicleId) {
          const vivaUserId = '0b9f107a-d124-49de-9ded-94698f63c1c4';
          
          const { data: newVehicle } = await supabase
            .from('vehicles')
            .insert({
              vin: vehicleInfo.vin || null, // Don't create fake VINs - let trigger handle pending status
              year: vehicleInfo.year,
              make: vehicleInfo.make,
              model: vehicleInfo.model,
              trim: vehicleInfo.trim,
              user_id: vivaUserId,
              uploaded_by: vivaUserId, // Required for origin tracking
              profile_origin: 'dropbox_import', // Explicit - don't rely on trigger
              discovery_source: 'dropbox_bulk_import', // Required for trigger detection
              origin_metadata: {
                import_job_id: jobId,
                dropbox_path: dropboxPath,
                folder_name: jacket.name,
                import_date: new Date().toISOString(),
                import_method: 'edge_function_bulk_import',
                automation_tracked: true
              },
              origin_organization_id: organizationId // Link to organization
            })
            .select('id')
            .single();

          vehicleId = newVehicle!.id;
          vehiclesCreated++;
          console.log(`  ✅ Created vehicle: ${vehicleInfo.year} ${vehicleInfo.make} ${vehicleInfo.model}`);
        } else {
          console.log(`  ⏭ Vehicle exists, updating...`);
        }

        // Upload images
        for (const img of jacket.files.images) {
          // Download from Dropbox
          const imgResponse = await fetch(img.url);
          const imgBlob = await imgResponse.blob();
          
          // Upload to Supabase storage
          const fileName = `${Date.now()}_${img.name}`;
          const storagePath = `vehicles/${vehicleId}/dropbox/${fileName}`;
          
          const { data: uploadData } = await supabase.storage
            .from('vehicle-data')
            .upload(storagePath, imgBlob);

          if (uploadData) {
            const publicUrl = supabase.storage.from('vehicle-data').getPublicUrl(storagePath).data.publicUrl;
            
            // Insert image record
            await supabase
              .from('vehicle_images')
              .insert({
                vehicle_id: vehicleId,
                user_id: '0b9f107a-d124-49de-9ded-94698f63c1c4',
                image_url: publicUrl,
                category: img.name.toLowerCase().includes('exterior') ? 'exterior' :
                         img.name.toLowerCase().includes('interior') ? 'interior' :
                         img.name.toLowerCase().includes('engine') ? 'engine' : 'other',
                metadata: { dropbox_path: img.path }
              });
          }
        }

        console.log(`  📸 Uploaded ${jacket.files.images.length} images`);

        // TODO: Parse PDFs for VIN, pricing, condition
        // TODO: Create dealer_inventory record
        // TODO: Create timeline event

        processedCount++;
        
        // Update job progress
        await supabase
          .from('dropbox_import_jobs')
          .update({ processed_files: processedCount, vehicles_created: vehiclesCreated })
          .eq('id', jobId);

      } catch (error: any) {
        console.error(`  ❌ Error processing ${jacket.name}:`, error.message);
      }
    }

    // Mark job complete
    await supabase
      .from('dropbox_import_jobs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString()
      })
      .eq('id', jobId);

    return new Response(
      JSON.stringify({
        success: true,
        jobId,
        totalFolders: dealJackets.size,
        processed: processedCount,
        vehiclesCreated
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Bulk import error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});

// Parse folder name to extract vehicle info
function parseFolderName(name: string): {
  year?: number;
  make?: string;
  model?: string;
  trim?: string;
  vin?: string;
} {
  // Format examples:
  // "1977 K5 Blazer - #VIN123"
  // "1974 Bronco"
  // "1965 Corvette Stingray - 194375S123456"

  const result: any = {};

  // Extract VIN (after # or 17-char alphanumeric)
  const vinMatch = name.match(/#([A-HJ-NPR-Z0-9]{17})|([A-HJ-NPR-Z0-9]{17})/i);
  if (vinMatch) {
    result.vin = (vinMatch[1] || vinMatch[2]).toUpperCase();
  }

  // Extract year (4 digits)
  const yearMatch = name.match(/\b(19|20)\d{2}\b/);
  if (yearMatch) {
    result.year = parseInt(yearMatch[0]);
  }

  // Remove VIN and year from name to get make/model
  let remaining = name
    .replace(/#?[A-HJ-NPR-Z0-9]{17}/gi, '')
    .replace(/\b(19|20)\d{2}\b/, '')
    .replace(/[-_]/g, ' ')
    .trim();

  const parts = remaining.split(/\s+/).filter(p => p.length > 0);
  
  if (parts.length >= 2) {
    result.make = parts[0];
    result.model = parts[1];
    if (parts.length > 2) {
      result.trim = parts.slice(2).join(' ');
    }
  }

  return result;
}

