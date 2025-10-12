/**
 * Image Data Extraction Service
 * Automatically extracts metadata and AI-analyzed data from images
 */

import { supabase } from '../lib/supabase';
import * as EXIF from 'exif-js';

interface ExtractedImageData {
  // EXIF Data
  exif: {
    dateTaken?: string;
    location?: {
      latitude: number;
      longitude: number;
      address?: string;
    };
    camera?: {
      make: string;
      model: string;
      lens?: string;
    };
    technical?: {
      iso?: number;
      aperture?: string;
      shutterSpeed?: string;
      focalLength?: string;
    };
  };
  
  // AI Extracted Tags
  tags: Array<{
    id: string;
    x?: number;  // Spatial position
    y?: number;
    text: string;
    type: 'product' | 'damage' | 'location' | 'modification' | 'brand' | 'part' | 'tool' | 'fluid';
    confidence: number;
    source: 'ai_vision' | 'exif' | 'manual';
    metadata?: any;
  }>;
  
  // Vehicle Context
  vehicleContext?: {
    area: 'exterior' | 'interior' | 'engine_bay' | 'undercarriage' | 'trunk' | 'dash';
    angle: string;
    condition: 'pristine' | 'good' | 'fair' | 'poor';
    modifications?: string[];
  };
}

export class ImageExtractionService {
  
  /**
   * Extract all data from an image at upload time
   */
  static async extractImageData(file: File, vehicleId: string): Promise<ExtractedImageData> {
    const extractedData: ExtractedImageData = {
      exif: {},
      tags: []
    };
    
    // 1. Extract EXIF data
    try {
      const exifData = await this.extractExifData(file);
      extractedData.exif = exifData;
      
      // Create location tags from EXIF GPS
      if (exifData.location) {
        extractedData.tags.push({
          id: crypto.randomUUID(),
          text: exifData.location.address || `${exifData.location.latitude}, ${exifData.location.longitude}`,
          type: 'location',
          confidence: 100,
          source: 'exif',
          metadata: exifData.location
        });
      }
    } catch (error) {
      console.warn('EXIF extraction failed:', error);
    }
    
    // 2. Run AI Vision Analysis
    try {
      const aiTags = await this.runAIVisionAnalysis(file, vehicleId);
      extractedData.tags.push(...aiTags);
    } catch (error) {
      console.warn('AI analysis failed:', error);
    }
    
    // 3. Save extracted data to database
    await this.saveExtractedData(vehicleId, file.name, extractedData);
    
    return extractedData;
  }
  
  /**
   * Extract EXIF metadata from image
   */
  private static extractExifData(file: File): Promise<ExtractedImageData['exif']> {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = function(e) {
        const arrayBuffer = e.target?.result as ArrayBuffer;
        const data: any = {};
        
        try {
          // Use EXIF.getData for proper extraction
          const exifData: any = EXIF.readFromBinaryFile(arrayBuffer);
          
          // Date taken
          if (exifData.DateTimeOriginal) {
            data.dateTaken = exifData.DateTimeOriginal;
          }
          
          // GPS Location
          if (exifData.GPSLatitude && exifData.GPSLongitude) {
            const lat = this.convertDMSToDD(
              exifData.GPSLatitude,
              exifData.GPSLatitudeRef
            );
            const lng = this.convertDMSToDD(
              exifData.GPSLongitude,
              exifData.GPSLongitudeRef
            );
            
            data.location = {
              latitude: lat,
              longitude: lng
            };
            
            // TODO: Reverse geocode to get address
            // this.reverseGeocode(lat, lng).then(address => {
            //   data.location.address = address;
            // });
          }
          
          // Camera info
          if (exifData.Make || exifData.Model) {
            data.camera = {
              make: exifData.Make || '',
              model: exifData.Model || '',
              lens: exifData.LensModel
            };
          }
          
          // Technical settings
          if (exifData.ISOSpeedRatings || exifData.FNumber) {
            data.technical = {
              iso: exifData.ISOSpeedRatings,
              aperture: exifData.FNumber ? `f/${exifData.FNumber}` : undefined,
              shutterSpeed: exifData.ExposureTime,
              focalLength: exifData.FocalLength ? `${exifData.FocalLength}mm` : undefined
            };
          }
        } catch (error) {
          console.warn('EXIF parse error:', error);
        }
        
        resolve(data);
      };
      
      reader.readAsArrayBuffer(file);
    });
  }
  
  /**
   * Convert GPS DMS to decimal degrees
   */
  private static convertDMSToDD(dms: number[], ref: string): number {
    let dd = dms[0] + dms[1] / 60 + dms[2] / 3600;
    if (ref === 'S' || ref === 'W') dd = dd * -1;
    return dd;
  }
  
  /**
   * Run AI vision analysis on image
   */
  private static async runAIVisionAnalysis(file: File, vehicleId: string): Promise<ExtractedImageData['tags']> {
    const tags: ExtractedImageData['tags'] = [];
    
    try {
      // Convert file to base64
      const base64 = await this.fileToBase64(file);
      
      // Call OpenAI Vision API
      const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
      if (!apiKey) {
        console.warn('OpenAI API key not configured');
        return tags;
      }
      
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4-vision-preview',
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: `Analyze this vehicle image and identify:
                  1. Visible products, tools, or parts (with brand if visible)
                  2. Any damage or wear
                  3. Modifications or upgrades
                  4. Vehicle area (exterior, interior, engine bay, etc.)
                  5. General condition assessment
                  
                  Return as JSON array of tags with format:
                  [{"text": "description", "type": "product|damage|modification|part|tool", "confidence": 0-100}]`
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:image/jpeg;base64,${base64}`
                  }
                }
              ]
            }
          ],
          max_tokens: 300
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        const content = data.choices[0]?.message?.content;
        
        // Parse AI response
        try {
          const aiTags = JSON.parse(content);
          aiTags.forEach((tag: any) => {
            tags.push({
              id: crypto.randomUUID(),
              text: tag.text,
              type: tag.type || 'part',
              confidence: tag.confidence || 50,
              source: 'ai_vision',
              metadata: tag
            });
          });
        } catch (parseError) {
          console.warn('Failed to parse AI response:', content);
        }
      }
    } catch (error) {
      console.error('AI vision analysis failed:', error);
    }
    
    return tags;
  }
  
  /**
   * Convert file to base64
   */
  private static fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const base64 = reader.result as string;
        resolve(base64.split(',')[1]);
      };
      reader.onerror = reject;
    });
  }
  
  /**
   * Save extracted data to database
   */
  private static async saveExtractedData(
    vehicleId: string,
    filename: string,
    data: ExtractedImageData
  ): Promise<void> {
    try {
      // Save tags to image_tags table
      for (const tag of data.tags) {
        await supabase.from('image_tags').insert({
          vehicle_id: vehicleId,
          tag_text: tag.text,
          tag_type: tag.type,
          confidence: tag.confidence,
          source: tag.source,
          metadata: tag.metadata || {},
          x_position: tag.x,
          y_position: tag.y
        });
      }
      
      // Update vehicle_images with EXIF data
      if (data.exif && Object.keys(data.exif).length > 0) {
        await supabase
          .from('vehicle_images')
          .update({ exif_data: data.exif })
          .eq('vehicle_id', vehicleId)
          .eq('filename', filename);
      }
      
      console.log(`Saved ${data.tags.length} tags for ${filename}`);
    } catch (error) {
      console.error('Failed to save extracted data:', error);
    }
  }
  
  /**
   * Backfill existing images with extraction
   */
  static async backfillExistingImages(vehicleId: string): Promise<void> {
    try {
      // Get all images without extracted data
      const { data: images, error } = await supabase
        .from('vehicle_images')
        .select('id, image_url, filename')
        .eq('vehicle_id', vehicleId)
        .is('exif_data', null)
        .limit(10); // Process in batches
      
      if (error) throw error;
      
      console.log(`Found ${images?.length || 0} images to process`);
      
      for (const image of images || []) {
        // Fetch image and process
        const response = await fetch(image.image_url);
        const blob = await response.blob();
        const file = new File([blob], image.filename, { type: blob.type });
        
        await this.extractImageData(file, vehicleId);
        
        // Add delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error) {
      console.error('Backfill failed:', error);
    }
  }
}

export default ImageExtractionService;
