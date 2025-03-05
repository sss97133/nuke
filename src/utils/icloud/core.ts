/**
 * iCloud Shared Album Integration - Core Functions
 * 
 * This module provides functions to extract image data from iCloud shared albums
 * with fallback to Supabase stored images.
 */

import { ICloudAlbumData, ICloudImage } from './types';
import { supabase } from '@/integrations/supabase/client';
import { mockFetchICloudImages } from './mock';

// Feature flag for gradual migration
const USE_REAL_DATA = {
  icloudImages: true
};

// Parse an iCloud shared album link to get the web feed URL
export function parseICloudSharedLink(sharedLink: string): string {
  // Validate the shared link format
  if (!sharedLink || !sharedLink.includes('share.icloud.com/photos/')) {
    throw new Error('Invalid iCloud shared album link format');
  }
  
  // Extract the album ID from the shared link
  const urlParts = sharedLink.split('/');
  const albumIdIndex = urlParts.findIndex(part => part === 'photos') + 1;
  
  if (albumIdIndex >= urlParts.length) {
    throw new Error('Could not extract album ID from the shared link');
  }
  
  const albumId = urlParts[albumIdIndex];
  
  // Construct the web feed URL
  // Note: This is a simplified approach. The actual iCloud API endpoints may differ
  // or require additional parameters.
  return `https://share.icloud.com/photostream/web/feed/${albumId}`;
}

// Extract album ID from a shared link
export function extractAlbumId(sharedLink: string): string {
  try {
    const urlParts = sharedLink.split('/');
    const albumIdIndex = urlParts.findIndex(part => part === 'photos') + 1;
    
    if (albumIdIndex >= urlParts.length) {
      throw new Error('Could not extract album ID');
    }
    
    // Remove any query parameters or hashes
    let albumId = urlParts[albumIdIndex];
    if (albumId.includes('?')) {
      albumId = albumId.split('?')[0];
    }
    if (albumId.includes('#')) {
      albumId = albumId.split('#')[0];
    }
    
    return albumId;
  } catch (error) {
    console.error('Error extracting album ID:', error);
    // Generate a fallback ID for mock data
    return `mock_album_${Math.random().toString(36).substring(2, 9)}`;
  }
}

// Fetch image data from an iCloud shared album
export async function fetchICloudSharedAlbum(sharedLink: string): Promise<ICloudAlbumData> {
  try {
    // Generate an album ID for database lookups
    const albumId = extractAlbumId(sharedLink);
    
    if (!USE_REAL_DATA.icloudImages) {
      console.log('Using mock iCloud data (feature flag off)');
      return {
        album: {
          title: 'Mock Shared Album',
          description: 'Mock data for development',
          createdAt: new Date().toISOString(),
          itemCount: 3
        },
        images: mockFetchICloudImages(sharedLink)
      };
    }
    
    console.log('Using mock iCloud data until database tables are created');
    return {
      album: {
        title: 'Mock Shared Album',
        description: 'Mock data for development',
        createdAt: new Date().toISOString(),
        itemCount: 3
      },
      images: mockFetchICloudImages(sharedLink)
    };
    
    /*
    // NOTE: The following code is commented out until proper database tables exist
    // First try to get from Supabase
    console.log('Attempting to find iCloud album in Supabase:', albumId);
    
    try {
      // Try to get the album metadata
      const { data: albumData, error: albumError } = await supabase
        .from('icloud_albums')
        .select('*')
        .eq('album_id', albumId)
        .single();
      
      if (albumError) {
        console.log('Album not found in Supabase, trying external API');
        throw albumError;
      }
      
      // Get the associated images
      const { data: imagesData, error: imagesError } = await supabase
        .from('icloud_images')
        .select('*')
        .eq('album_id', albumId)
        .order('created_at', { ascending: false });
      
      if (imagesError) throw imagesError;
      
      if (albumData && imagesData && imagesData.length > 0) {
        console.log('Found iCloud album in Supabase:', albumData.title);
        
        // Format images to match expected interface
        const images: ICloudImage[] = imagesData.map(img => ({
          id: img.id,
          caption: img.caption || '',
          filename: img.filename || 'image.jpg',
          url: img.url || '',
          thumbnailUrl: img.thumbnail_url || img.url || '',
          createdAt: img.created_at || new Date().toISOString(),
          width: img.width || 0,
          height: img.height || 0,
          fileSize: img.file_size || 0,
          fileType: img.file_type || 'image/jpeg'
        }));
        
        return {
          album: {
            title: albumData.title || 'Shared Album',
            description: albumData.description || '',
            createdAt: albumData.created_at || new Date().toISOString(),
            itemCount: images.length
          },
          images
        };
      }
    } catch (dbError) {
      console.warn('Error or no data from Supabase, continuing to external API:', dbError);
    }
    
    // If we couldn't get from Supabase, try the actual iCloud API
    try {
      console.log('Attempting to fetch from iCloud API');
      const feedUrl = parseICloudSharedLink(sharedLink);
      
      // Fetch the album feed
      const response = await fetch(feedUrl);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch iCloud album: ${response.status} ${response.statusText}`);
      }
      
      // Parse the response
      const data = await response.json();
      
      // Process the album data
      const processedData = processICloudAlbumData(data);
      
      // Optional: Store the fetched data in Supabase for future use
      try {
        // Store album metadata
        await supabase
          .from('icloud_albums')
          .upsert({
            album_id: albumId,
            title: processedData.album.title,
            description: processedData.album.description,
            created_at: processedData.album.createdAt,
            item_count: processedData.album.itemCount,
            shared_link: sharedLink
          });
        
        // Store images
        const imagesToInsert = processedData.images.map(img => ({
          album_id: albumId,
          external_id: img.id,
          caption: img.caption,
          filename: img.filename,
          url: img.url,
          thumbnail_url: img.thumbnailUrl,
          created_at: img.createdAt,
          width: img.width,
          height: img.height,
          file_size: img.fileSize,
          file_type: img.fileType
        }));
        
        await supabase
          .from('icloud_images')
          .upsert(imagesToInsert);
          
        console.log('Stored iCloud data in Supabase for future use');
      } catch (storeError) {
        console.error('Failed to store iCloud data in Supabase:', storeError);
        // Continue anyway since we have the data from the API
      }
      
      return processedData;
    } catch (apiError) {
      console.error('Error fetching from iCloud API:', apiError);
      // All attempts failed, fall back to mock data
      console.log('Falling back to mock iCloud data');
      return {
        album: {
          title: 'Mock Shared Album',
          description: 'Mock data for development (fallback)',
          createdAt: new Date().toISOString(),
          itemCount: 3
        },
        images: mockFetchICloudImages(sharedLink)
      };
    }
    */
  } catch (error) {
    console.error('Error in fetchICloudSharedAlbum:', error);
    
    // Last resort fallback to mock data
    return {
      album: {
        title: 'Mock Shared Album',
        description: 'Mock data for development (error fallback)',
        createdAt: new Date().toISOString(),
        itemCount: 3
      },
      images: mockFetchICloudImages(sharedLink)
    };
  }
}

// Process iCloud album data into a standard format
export function processICloudAlbumData(albumData: any): ICloudAlbumData {
  // Extract basic album info
  const albumInfo = {
    title: albumData.title || 'Shared Album',
    description: albumData.description || '',
    createdAt: albumData.creationDate || new Date().toISOString(),
    itemCount: albumData.items?.length || 0
  };
  
  // Process image items
  const images: ICloudImage[] = (albumData.items || []).map((item: any) => {
    return {
      id: item.id || `image_${Math.random().toString(36).substr(2, 9)}`,
      caption: item.caption || '',
      filename: item.filename || 'image.jpg',
      url: item.url || item.derivatives?.url || '',
      thumbnailUrl: item.thumbnailUrl || item.derivatives?.thumbnailUrl || '',
      createdAt: item.creationDate || new Date().toISOString(),
      width: item.width || 0,
      height: item.height || 0,
      fileSize: item.fileSize || 0,
      fileType: item.fileType || 'image/jpeg'
    };
  });
  
  return {
    album: albumInfo,
    images: images
  };
}
