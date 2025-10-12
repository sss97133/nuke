// EXIF data extraction utilities
import piexifjs from 'piexifjs';

interface GPSCoordinates {
  latitude: number | null;
  longitude: number | null;
}

interface ExifData {
  gps: GPSCoordinates;
  dateTaken?: string;
  camera?: string;
  orientation?: number;
  [key: string]: any;
}

export class ExifExtractor {
  // Convert DMS (degrees, minutes, seconds) to decimal degrees
  private static dmsToDecimal(dms: number[][]): number {
    if (!dms || dms.length !== 3) return 0;
    
    const degrees = dms[0][0] / dms[0][1];
    const minutes = dms[1][0] / dms[1][1] / 60;
    const seconds = dms[2][0] / dms[2][1] / 3600;
    
    return degrees + minutes + seconds;
  }

  // Extract GPS coordinates from EXIF data
  static async extractGPS(file: File): Promise<GPSCoordinates> {
    try {
      const dataUrl = await this.fileToDataUrl(file);
      const exifData = piexifjs.load(dataUrl);
      
      if (!exifData.GPS) {
        return { latitude: null, longitude: null };
      }
      
      const gps = exifData.GPS;
      const latDMS = gps[piexifjs.GPSIFD.GPSLatitude];
      const lonDMS = gps[piexifjs.GPSIFD.GPSLongitude];
      const latRef = gps[piexifjs.GPSIFD.GPSLatitudeRef];
      const lonRef = gps[piexifjs.GPSIFD.GPSLongitudeRef];
      
      if (!latDMS || !lonDMS) {
        return { latitude: null, longitude: null };
      }
      
      let latitude = this.dmsToDecimal(latDMS);
      let longitude = this.dmsToDecimal(lonDMS);
      
      // Apply hemisphere modifiers
      if (latRef === 'S') latitude = -latitude;
      if (lonRef === 'W') longitude = -longitude;
      
      return { latitude, longitude };
    } catch (error) {
      console.error('Error extracting GPS from EXIF:', error);
      return { latitude: null, longitude: null };
    }
  }

  // Extract all EXIF data
  static async extractAll(file: File): Promise<ExifData> {
    try {
      const dataUrl = await this.fileToDataUrl(file);
      const exifData = piexifjs.load(dataUrl);
      
      const gps = await this.extractGPS(file);
      
      // Extract other useful data
      const exif = exifData['0th'] || {};
      const exifExt = exifData['Exif'] || {};
      
      return {
        gps,
        dateTaken: exifExt[36867] || exifExt[36868], // DateTimeOriginal or DateTimeDigitized
        camera: `${exif[piexifjs.ImageIFD.Make] || ''} ${exif[piexifjs.ImageIFD.Model] || ''}`.trim(),
        orientation: exif[piexifjs.ImageIFD.Orientation],
        raw: exifData
      };
    } catch (error) {
      console.error('Error extracting EXIF data:', error);
      return {
        gps: { latitude: null, longitude: null }
      };
    }
  }

  // Convert file to data URL
  private static fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // Convert file to binary string (for piexifjs)
  static async fileToBinaryString(file: File): Promise<string> {
    const dataUrl = await this.fileToDataUrl(file);
    return dataUrl.split(',')[1] || '';
  }
}
