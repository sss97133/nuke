
/**
 * iCloud Shared Album Integration - Mock Functions
 * 
 * For development and testing purposes when actual iCloud API is not available
 */

import { ICloudImage } from './types';

// Mock function to simulate fetching iCloud images when actual API is not available
export function mockFetchICloudImages(albumLink: string): ICloudImage[] {
  console.log(`Simulating fetch from iCloud album: ${albumLink}`);
  
  // Return mock image data that would come from iCloud
  return [
    {
      id: 'icloud_img_1',
      caption: 'Front view',
      filename: 'exterior_front.jpg',
      url: 'https://via.placeholder.com/800x600?text=iCloud+Photo+1',
      thumbnailUrl: 'https://via.placeholder.com/200x150?text=iCloud+Thumb+1',
      createdAt: new Date().toISOString(),
      width: 800,
      height: 600,
      fileSize: 150000,
      fileType: 'image/jpeg'
    },
    {
      id: 'icloud_img_2',
      caption: 'Side view',
      filename: 'exterior_side.jpg',
      url: 'https://via.placeholder.com/800x600?text=iCloud+Photo+2',
      thumbnailUrl: 'https://via.placeholder.com/200x150?text=iCloud+Thumb+2',
      createdAt: new Date().toISOString(),
      width: 800,
      height: 600,
      fileSize: 145000,
      fileType: 'image/jpeg'
    },
    {
      id: 'icloud_img_3',
      caption: 'Interior',
      filename: 'interior.jpg',
      url: 'https://via.placeholder.com/800x600?text=iCloud+Photo+3',
      thumbnailUrl: 'https://via.placeholder.com/200x150?text=iCloud+Thumb+3',
      createdAt: new Date().toISOString(),
      width: 800,
      height: 600,
      fileSize: 160000,
      fileType: 'image/jpeg'
    }
  ];
}
