/**
 * Backfill script to add missing EXIF data to existing images
 * - Extracts EXIF from image URLs
 * - Adds reverse geocoding for GPS coordinates
 * - Updates exif_data structure to match new format
 */

import { createClient } from '@supabase/supabase-js';
import exifr from 'exifr';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

if (!supabaseKey) {
  console.error('Missing Supabase key');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function reverseGeocode(lat: number, lon: number): Promise<{ city?: string; state?: string; address?: string } | null> {
  try {
    const response = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`
    );
    
    if (response.ok) {
      const data = await response.json();
      const parts = [];
      if (data.locality) parts.push(data.locality);
      else if (data.city) parts.push(data.city);
      if (data.principalSubdivision) parts.push(data.principalSubdivision);
      
      if (parts.length > 0) {
        return {
          city: parts[0],
          state: parts[1],
          address: parts.join(', ')
        };
      }
    }
  } catch (error) {
    console.warn('Reverse geocoding failed:', error);
  }
  
  return null;
}

async function extractExifFromUrl(imageUrl: string): Promise<any> {
  try {
    const response = await fetch(imageUrl);
    const blob = await response.blob();
    const exifData = await exifr.parse(blob, {
      gps: true,
      pick: [
        'DateTimeOriginal', 'DateTime', 'CreateDate',
        'GPSLatitude', 'GPSLongitude', 'latitude', 'longitude',
        'GPSLatitudeRef', 'GPSLongitudeRef',
        'Make', 'Model', 'ImageWidth', 'ImageHeight',
        'ISO', 'FNumber', 'ExposureTime', 'FocalLength'
      ]
    });
    
    return exifData;
  } catch (error) {
    console.warn('EXIF extraction failed:', error);
    return null;
  }
}

async function processImage(image: any) {
  console.log(`\nProcessing: ${image.file_name || image.id}`);
  
  try {
    // Extract EXIF from image URL
    const exifData = await extractExifFromUrl(image.image_url);
    
    if (!exifData) {
      console.log('  ⚠️  No EXIF data found');
      return;
    }
    
    // Build updated exif_data structure
    const updatedExif: any = {
      ...(image.exif_data || {}), // Preserve existing data
      DateTimeOriginal: exifData.DateTimeOriginal || exifData.DateTime || exifData.CreateDate || image.exif_data?.DateTimeOriginal,
    };
    
    // Camera info
    if (exifData.Make && exifData.Model) {
      updatedExif.camera = {
        make: exifData.Make,
        model: exifData.Model
      };
    } else if (image.exif_data?.camera) {
      updatedExif.camera = image.exif_data.camera;
    }
    
    // Technical settings - store raw values
    const technical: any = {};
    if (exifData.ISO) {
      technical.iso = typeof exifData.ISO === 'number' ? exifData.ISO : parseFloat(exifData.ISO);
    }
    if (exifData.FNumber) {
      technical.fNumber = typeof exifData.FNumber === 'number' ? exifData.FNumber : parseFloat(exifData.FNumber);
    }
    if (exifData.ExposureTime) {
      technical.exposureTime = typeof exifData.ExposureTime === 'number' ? exifData.ExposureTime : parseFloat(exifData.ExposureTime);
    }
    if (exifData.FocalLength) {
      technical.focalLength = typeof exifData.FocalLength === 'number' ? exifData.FocalLength : parseFloat(exifData.FocalLength);
    }
    
    if (Object.keys(technical).length > 0) {
      updatedExif.technical = technical;
      // Also store at top level for easy access
      updatedExif.fNumber = technical.fNumber;
      updatedExif.exposureTime = technical.exposureTime;
      updatedExif.iso = technical.iso;
      updatedExif.focalLength = technical.focalLength;
    }
    
    // GPS/Location
    let lat = exifData.latitude || exifData.GPSLatitude;
    let lon = exifData.longitude || exifData.GPSLongitude;
    
    // Handle GPS reference directions
    if (exifData.GPSLatitudeRef === 'S' && lat > 0) lat = -lat;
    if (exifData.GPSLongitudeRef === 'W' && lon > 0) lon = -lon;
    
    if (lat && lon && typeof lat === 'number' && typeof lon === 'number') {
      // Reverse geocode to get city/state
      const geocoded = await reverseGeocode(lat, lon);
      
      updatedExif.location = {
        latitude: lat,
        longitude: lon,
        ...(geocoded || {})
      };
      
      updatedExif.gps = {
        latitude: lat,
        longitude: lon
      };
      
      if (geocoded) {
        console.log(`  ✅ Location: ${geocoded.address || `${lat}, ${lon}`}`);
      } else {
        console.log(`  📍 GPS: ${lat.toFixed(4)}, ${lon.toFixed(4)}`);
      }
    } else if (image.exif_data?.location) {
      // Preserve existing location if no new GPS found
      updatedExif.location = image.exif_data.location;
      updatedExif.gps = image.exif_data.gps || (image.exif_data.location.latitude ? {
        latitude: image.exif_data.location.latitude,
        longitude: image.exif_data.location.longitude
      } : null);
    }
    
    // Dimensions
    if (exifData.ImageWidth && exifData.ImageHeight) {
      updatedExif.dimensions = {
        width: exifData.ImageWidth,
        height: exifData.ImageHeight
      };
    } else if (image.exif_data?.dimensions) {
      updatedExif.dimensions = image.exif_data.dimensions;
    }
    
    // Update database
    const updateData: any = {
      exif_data: updatedExif
    };
    
    // Also update top-level latitude/longitude if we have GPS
    if (lat && lon) {
      updateData.latitude = lat;
      updateData.longitude = lon;
    }
    
    const { error } = await supabase
      .from('vehicle_images')
      .update(updateData)
      .eq('id', image.id);
    
    if (error) {
      console.error('  ❌ Update failed:', error.message);
    } else {
      console.log('  ✅ Updated successfully');
    }
    
  } catch (error: any) {
    console.error('  ❌ Error processing:', error.message);
  }
}

async function main() {
  console.log('Starting EXIF data backfill...\n');
  
  // Get images that need processing (missing EXIF technical data or location city/state)
  const { data: images, error } = await supabase
    .from('vehicle_images')
    .select('id, image_url, file_name, exif_data, latitude, longitude')
    .not('image_url', 'is', null)
    .limit(100); // Process in batches
  
  if (error) {
    console.error('Error fetching images:', error);
    return;
  }
  
  if (!images || images.length === 0) {
    console.log('No images to process');
    return;
  }
  
  console.log(`Found ${images.length} images to process\n`);
  
  for (const image of images) {
    await processImage(image);
    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  console.log('\n✅ Backfill complete!');
}

main().catch(console.error);

