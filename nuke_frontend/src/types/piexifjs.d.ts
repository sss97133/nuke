declare module 'piexifjs' {
  export interface ImageIFD {
    Make: number;
    Model: number;
    DateTime: number;
    Orientation: number;
  }

  export interface ExifIFD {
    PixelXDimension: number;
    PixelYDimension: number;
    ISOSpeedRatings: number;
    FocalLength: number;
    FNumber: number;
    ExposureTime: number;
    Flash: number;
    WhiteBalance: number;
    ColorSpace: number;
  }

  export interface GPSIFD {
    GPSLatitude: number;
    GPSLongitude: number;
    GPSLatitudeRef: number;
    GPSLongitudeRef: number;
  }

  export const ImageIFD: ImageIFD;
  export const ExifIFD: ExifIFD;
  export const GPSIFD: GPSIFD;

  export function load(data: ArrayBuffer | string): any;
  export function dump(exifDict: any): string;
}
