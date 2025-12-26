#!/usr/bin/env node
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../nuke_frontend/.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const vehicleId = '1dd2b43f-9f5a-45dd-b7f9-88c6fdf64e3e';

// Clean URLs: remove -scaled, remove resize params
const cleanUrl = (url) => {
  return url
    .replace(/&#038;/g, '&')
    .replace(/&amp;/g, '&')
    .replace(/[?&]fit=[^&]*/g, '')
    .replace(/[?&]w=\d+/g, '')
    .replace(/[?&]h=\d+/g, '')
    .replace(/[?&]resize=[^&]*/g, '')
    .replace(/[?&]+$/, '')
    .replace(/-scaled\.(jpg|jpeg|png|webp)$/i, '.$1')
    .trim();
};

const imageUrls = [
  'https://bringatrailer.com/wp-content/uploads/2024/08/1986_land-rover_110_IMG_6558-25688-scaled.jpg?fit=2048%2C1536',
  'https://bringatrailer.com/wp-content/uploads/2024/08/1986_land-rover_110_IMG_6572-25891-scaled.jpg?fit=2048%2C1536',
  'https://bringatrailer.com/wp-content/uploads/2024/08/1986_land-rover_110_IMG_6570-25830-scaled.jpg?fit=2048%2C1536',
  'https://bringatrailer.com/wp-content/uploads/2024/08/1986_land-rover_110_IMG_6571-25861-scaled.jpg?fit=2048%2C1536',
  'https://bringatrailer.com/wp-content/uploads/2024/08/1986_land-rover_110_IMG_6569-25796-scaled.jpg?fit=2048%2C1536',
  'https://bringatrailer.com/wp-content/uploads/2024/08/1986_land-rover_110_IMG_6568-25789-scaled.jpg?fit=2048%2C1536',
  'https://bringatrailer.com/wp-content/uploads/2024/08/1986_land-rover_110_IMG_6567-25783-scaled.jpg?fit=2048%2C1536',
  'https://bringatrailer.com/wp-content/uploads/2024/08/1986_land-rover_110_IMG_6566-25776-scaled.jpg?fit=2048%2C1536',
  'https://bringatrailer.com/wp-content/uploads/2024/08/1986_land-rover_110_IMG_6565-25767-scaled.jpg?fit=2048%2C1536',
  'https://bringatrailer.com/wp-content/uploads/2024/08/1986_land-rover_110_IMG_6564-25759-scaled.jpg?fit=2048%2C1536',
  'https://bringatrailer.com/wp-content/uploads/2024/08/1986_land-rover_110_IMG_6563-25752-scaled.jpg?fit=2048%2C1536',
  'https://bringatrailer.com/wp-content/uploads/2024/08/1986_land-rover_110_IMG_6562-25744-scaled.jpg?fit=2048%2C1536',
  'https://bringatrailer.com/wp-content/uploads/2024/08/1986_land-rover_110_IMG_6561-25737-scaled.jpg?fit=2048%2C1536',
  'https://bringatrailer.com/wp-content/uploads/2024/08/1986_land-rover_110_IMG_6560-25730-scaled.jpg?fit=2048%2C1536',
  'https://bringatrailer.com/wp-content/uploads/2024/08/1986_land-rover_110_IMG_6559-25703-scaled.jpg?fit=2048%2C1536',
  'https://bringatrailer.com/wp-content/uploads/2024/08/1986_land-rover_110_IMG_6578-26051-scaled.jpg?fit=2048%2C1536',
  'https://bringatrailer.com/wp-content/uploads/2024/08/1986_land-rover_110_IMG_6577-26024-scaled.jpg?fit=2048%2C1536',
  'https://bringatrailer.com/wp-content/uploads/2024/08/1986_land-rover_110_IMG_6580-26100-scaled.jpg?fit=2048%2C1536',
  'https://bringatrailer.com/wp-content/uploads/2024/08/1986_land-rover_110_IMG_6579-26071-scaled.jpg?fit=2048%2C1536',
  'https://bringatrailer.com/wp-content/uploads/2024/08/1986_land-rover_110_IMG_6576-25996-scaled.jpg?fit=2048%2C1536',
];

const cleanedUrls = imageUrls.map(cleanUrl);

console.log('Inserting', cleanedUrls.length, 'high-res images...');

const imagesToInsert = cleanedUrls.map((url, idx) => ({
  vehicle_id: vehicleId,
  image_url: url,
  source: 'bat_import',
  is_primary: idx === 0,
  position: idx,
  is_document: false,
}));

const { data, error } = await supabase
  .from('vehicle_images')
  .insert(imagesToInsert)
  .select();

if (error) {
  console.error('Error:', error);
  process.exit(1);
} else {
  console.log('Successfully inserted', data?.length || 0, 'images');
  console.log('First image URL:', cleanedUrls[0]);
}

