import exifr from 'exifr';

export interface ImageMetadata {
  fileName: string;
  fileSize: number;
  dateTaken?: Date;
  location?: {
    latitude: number;
    longitude: number;
    address?: string;
  };
  camera?: {
    make: string;
    model: string;
  };
  technical?: {
    iso?: number;
    aperture?: string;
    shutterSpeed?: string;
    focalLength?: string;
  };
  dimensions?: {
    width: number;
    height: number;
  };
}

export async function extractImageMetadata(file: File): Promise<ImageMetadata> {
  const metadata: ImageMetadata = {
    fileName: file.name,
    fileSize: file.size,
  };

  try {
    console.log('Extracting EXIF data from:', file.name);
    
    // Extract EXIF data with more comprehensive options
    const exifData = await exifr.parse(file, {
      gps: true,
      pick: [
        'DateTimeOriginal', 'DateTime', 'CreateDate',
        'GPSLatitude', 'GPSLongitude', 'latitude', 'longitude',
        'GPSLatitudeRef', 'GPSLongitudeRef',
        'Make', 'Model', 'ImageWidth', 'ImageHeight',
        'ISO', 'FNumber', 'ExposureTime', 'FocalLength'
      ]
    });

    console.log('Raw EXIF data:', exifData);

    if (exifData) {
      // Extract date taken - try multiple fields
      if (exifData.DateTimeOriginal) {
        metadata.dateTaken = new Date(exifData.DateTimeOriginal);
        console.log('Found DateTimeOriginal:', metadata.dateTaken);
      } else if (exifData.DateTime) {
        metadata.dateTaken = new Date(exifData.DateTime);
        console.log('Found DateTime:', metadata.dateTaken);
      } else if (exifData.CreateDate) {
        metadata.dateTaken = new Date(exifData.CreateDate);
        console.log('Found CreateDate:', metadata.dateTaken);
      }

      // Extract GPS coordinates - try multiple field names and handle different formats
      console.log('Raw EXIF GPS data:', {
        latitude: exifData.latitude,
        longitude: exifData.longitude,
        GPSLatitude: exifData.GPSLatitude,
        GPSLongitude: exifData.GPSLongitude,
        GPSLatitudeRef: exifData.GPSLatitudeRef,
        GPSLongitudeRef: exifData.GPSLongitudeRef
      });
      
      let lat = exifData.latitude || exifData.GPSLatitude;
      let lon = exifData.longitude || exifData.GPSLongitude;
      
      // Handle GPS reference directions (N/S for latitude, E/W for longitude)
      if (exifData.GPSLatitudeRef === 'S' && lat > 0) {
        lat = -lat;
        console.log('Applied South latitude correction:', lat);
      }
      if (exifData.GPSLongitudeRef === 'W' && lon > 0) {
        lon = -lon;
        console.log('Applied West longitude correction:', lon);
      }
      
      if (lat && lon) {
        // Validate coordinates are reasonable
        if (typeof lat === 'number' && typeof lon === 'number' && 
            lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
          metadata.location = {
            latitude: lat,
            longitude: lon,
          };
          console.log('Final GPS coordinates after processing:', lat, lon);
          
          // Log if coordinates seem unusual for US locations
          if (lat < 24 || lat > 49 || lon > -66 || lon < -125) {
            console.warn('GPS coordinates appear to be outside US bounds - photo may have incorrect location data');
            console.warn('Expected US bounds: lat 24-49, lon -125 to -66');
          }
        } else {
          console.warn('Invalid GPS coordinates found:', lat, lon);
        }
      }

      // Extract camera info
      if (exifData.Make && exifData.Model) {
        metadata.camera = {
          make: exifData.Make,
          model: exifData.Model
        };
        console.log('Found camera info:', metadata.camera);
      }

      // Extract technical camera settings
      const technical: any = {};
      if (exifData.ISO) {
        technical.iso = exifData.ISO;
      }
      if (exifData.FNumber) {
        technical.aperture = `f/${exifData.FNumber}`;
      }
      if (exifData.ExposureTime) {
        technical.shutterSpeed = exifData.ExposureTime < 1 ? `1/${Math.round(1/exifData.ExposureTime)}` : `${exifData.ExposureTime}s`;
      }
      if (exifData.FocalLength) {
        technical.focalLength = `${exifData.FocalLength}mm`;
      }
      
      if (Object.keys(technical).length > 0) {
        metadata.technical = technical;
        console.log('Found technical settings:', metadata.technical);
      }

      // Extract dimensions
      if (exifData.ImageWidth && exifData.ImageHeight) {
        metadata.dimensions = {
          width: exifData.ImageWidth,
          height: exifData.ImageHeight
        };
        console.log('Found dimensions:', metadata.dimensions);
      }
    } else {
      console.log('No EXIF data found in', file.name);
    }
  } catch (error) {
    console.error('Failed to extract EXIF data from', file.name, error);
  }

  console.log('Final metadata for', file.name, ':', metadata);
  return metadata;
}

export async function reverseGeocode(latitude: number, longitude: number): Promise<string | null> {
  try {
    console.log(`Reverse geocoding: ${latitude}, ${longitude}`);
    
    // Validate coordinates are reasonable for US locations
    if (latitude < 24 || latitude > 49 || longitude > -66 || longitude < -125) {
      console.warn('GPS coordinates appear to be outside US bounds:', latitude, longitude);
    }
    
    const response = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`
    );
    
    if (response.ok) {
      const data = await response.json();
      console.log('Reverse geocode API response:', data);
      
      const parts = [];
      
      // Prefer more specific location names first
      if (data.locality) parts.push(data.locality);
      else if (data.city) parts.push(data.city);
      
      if (data.principalSubdivision) parts.push(data.principalSubdivision);
      if (data.countryName) parts.push(data.countryName);
      
      const result = parts.join(', ') || null;
      console.log('Final geocoded address:', result);
      return result;
    } else {
      console.error('Reverse geocoding API error:', response.status, response.statusText);
    }
  } catch (error) {
    console.warn('Failed to reverse geocode coordinates', error);
  }
  
  return null;
}

export function getEventDateFromImages(images: ImageMetadata[]): Date | null {
  const datesWithImages = images
    .filter(img => img.dateTaken)
    .map(img => img.dateTaken!)
    .sort((a, b) => a.getTime() - b.getTime());

  // Return the earliest date (when the first photo was taken)
  return datesWithImages.length > 0 ? datesWithImages[0] : null;
}

export function getEventLocationFromImages(images: ImageMetadata[]): { latitude: number; longitude: number } | null {
  const locationsWithImages = images.filter(img => img.location);
  
  if (locationsWithImages.length === 0) return null;
  
  // If multiple locations, use the first one (could be enhanced to find most common location)
  return locationsWithImages[0].location!;
}
