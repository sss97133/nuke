// piexifjs 1.0.6 ships no types. load() always returns every IFD key, possibly empty.
declare module 'piexifjs' {
  type Ifd = Record<number, any>;
  export interface ExifObject {
    '0th': Ifd;
    Exif: Ifd;
    GPS: Ifd;
    Interop: Ifd;
    '1st': Ifd;
    thumbnail: string | null;
  }
  export function load(data: string): ExifObject;
  export const ImageIFD: Record<string, number>;
  export const ExifIFD: Record<string, number>;
  export const GPSIFD: Record<string, number>;
  const piexif: { load: typeof load; ImageIFD: typeof ImageIFD; ExifIFD: typeof ExifIFD; GPSIFD: typeof GPSIFD };
  export default piexif;
}
