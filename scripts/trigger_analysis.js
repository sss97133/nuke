
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// Load env vars - try multiple locations
let envConfig: any = {};
const possiblePaths = [
  path.resolve(process.cwd(), 'nuke_frontend/.env.local'),
  path.resolve(process.cwd(), '.env.local'),
  path.resolve(process.cwd(), '.env')
];

for (const envPath of possiblePaths) {
  try {
    if (fs.existsSync(envPath)) {
      envConfig = dotenv.parse(fs.readFileSync(envPath));
      console.log(`Loaded env from: ${envPath}`);
      break;
    }
  } catch (e) {
    // Try next path
  }
}

// Also check process.env directly (for CI/CD)
const supabaseUrl = envConfig.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = envConfig.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase env vars. Tried:', possiblePaths);
  console.error('Have VITE_SUPABASE_URL:', !!supabaseUrl);
  console.error('Have VITE_SUPABASE_ANON_KEY:', !!supabaseKey);
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const VEHICLE_ID = 'e08bf694-970f-4cbe-8a74-8715158a0f2e';

async function run() {
  console.log(`Fetching images for vehicle ${VEHICLE_ID}...`);
  
  const { data: images, error } = await supabase
    .from('vehicle_images')
    .select('id, image_url')
    .eq('vehicle_id', VEHICLE_ID);
    
  if (error) {
    console.error('Error fetching images:', error);
    return;
  }
  
  console.log(`Found ${images.length} images. Triggering analysis...`);
  
  for (const image of images) {
    console.log(`Analyzing ${image.id}...`);
    
    try {
      const { data, error: fnError } = await supabase.functions.invoke('analyze-image', {
        body: {
          image_url: image.image_url,
          vehicle_id: VEHICLE_ID,
          timeline_event_id: null
        }
      });
      
      if (fnError) {
        console.error(`Failed to analyze ${image.id}:`, fnError);
      } else {
        console.log(`Success ${image.id}:`, data?.success ? 'OK' : data);
      }
      
      // Rate limit slightly
      await new Promise(r => setTimeout(r, 500));
      
    } catch (e) {
      console.error(`Exception for ${image.id}:`, e);
    }
  }
  
  console.log('Done!');
}

run();

