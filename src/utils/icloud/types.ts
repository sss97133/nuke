
/**
 * Types for iCloud shared album data
 */

export interface ICloudImage {
  id: string;
  caption: string;
  filename: string;
  url: string;
  thumbnailUrl: string;
  createdAt: string;
  width: number;
  height: number;
  fileSize: number;
  fileType: string;
}

export interface ICloudAlbumInfo {
  title: string;
  description: string;
  createdAt: string;
  itemCount: number;
}

export interface ICloudAlbumData {
  album: ICloudAlbumInfo;
  images: ICloudImage[];
}
