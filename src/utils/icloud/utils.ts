
/**
 * iCloud Shared Album Integration - Utility Functions
 */

import { ICloudAlbumData } from './types';

// Utility function to extract HD image URLs from the shared album
export function extractHDImageUrls(albumData: ICloudAlbumData): { id: string; filename: string; url: string }[] {
  if (!albumData || !albumData.images || !Array.isArray(albumData.images)) {
    return [];
  }
  
  // Extract the highest quality image URLs
  return albumData.images.map(image => {
    return {
      id: image.id,
      filename: image.filename,
      url: image.url
    };
  });
}

// Download an image from iCloud shared album
export async function downloadICloudImage(imageUrl: string, filename?: string): Promise<boolean> {
  try {
    const response = await fetch(imageUrl);
    
    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
    }
    
    // Convert response to blob
    const blob = await response.blob();
    
    // Create a download link
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename || 'icloud_image.jpg';
    
    // Trigger download
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    // Clean up
    URL.revokeObjectURL(url);
    
    return true;
  } catch (error) {
    console.error('Error downloading iCloud image:', error);
    throw error;
  }
}
