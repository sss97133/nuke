import { supabase } from '../lib/supabase';

export interface ImageMetadata {
  file: File;
  fileName: string;
  timestamp: Date;
  exifData?: any;
  vehicleId: string;
  userId: string;
}

export interface WorkSession {
  id: string;
  vehicle_id: string;
  user_id: string;
  session_date: string;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  start_image_id?: string;
  end_image_id?: string;
  work_description?: string;
  session_type: 'continuous' | 'break_detected' | 'manual';
  confidence_score: number;
  created_at: string;
}

export interface WorkSessionGroup {
  date: string;
  sessions: WorkSession[];
  totalDuration: number;
  imageCount: number;
  images: ImageMetadata[];
}

export class WorkSessionService {
  /**
   * Extract timestamp from image file using EXIF data or file modification date
   */
  static async extractImageTimestamp(file: File): Promise<Date> {
    try {
      // Try to get EXIF data first
      const exifTimestamp = await this.getExifTimestamp(file);
      if (exifTimestamp) {
        return exifTimestamp;
      }
    } catch (error) {
      console.warn('Failed to extract EXIF timestamp:', error);
    }

    // Fallback to file modification date
    return new Date(file.lastModified);
  }

  /**
   * Extract EXIF timestamp from image file
   */
  private static async getExifTimestamp(file: File): Promise<Date | null> {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const arrayBuffer = e.target?.result as ArrayBuffer;
          const dataView = new DataView(arrayBuffer);
          
          // Look for JPEG EXIF marker (0xFFE1)
          let offset = 0;
          
          // Check for JPEG signature
          if (dataView.getUint16(0) !== 0xFFD8) {
            resolve(null);
            return;
          }
          
          offset = 2;
          while (offset < dataView.byteLength - 4) {
            const marker = dataView.getUint16(offset);
            const length = dataView.getUint16(offset + 2);
            
            if (marker === 0xFFE1) {
              // Found EXIF segment
              const exifOffset = offset + 4;
              
              // Check for "Exif\0\0" header
              if (dataView.getUint32(exifOffset) === 0x45786966 && 
                  dataView.getUint16(exifOffset + 4) === 0x0000) {
                
                const tiffOffset = exifOffset + 6;
                const byteOrder = dataView.getUint16(tiffOffset);
                const isLittleEndian = byteOrder === 0x4949;
                
                // Get IFD0 offset
                const ifd0Offset = tiffOffset + (isLittleEndian ? 
                  dataView.getUint32(tiffOffset + 4, true) : 
                  dataView.getUint32(tiffOffset + 4, false));
                
                // Parse IFD0 entries
                const entryCount = isLittleEndian ? 
                  dataView.getUint16(ifd0Offset, true) : 
                  dataView.getUint16(ifd0Offset, false);
                
                for (let i = 0; i < entryCount; i++) {
                  const entryOffset = ifd0Offset + 2 + (i * 12);
                  const tag = isLittleEndian ? 
                    dataView.getUint16(entryOffset, true) : 
                    dataView.getUint16(entryOffset, false);
                  
                  // DateTime tag (0x0132)
                  if (tag === 0x0132) {
                    const valueOffset = isLittleEndian ? 
                      dataView.getUint32(entryOffset + 8, true) : 
                      dataView.getUint32(entryOffset + 8, false);
                    
                    // Read datetime string
                    let dateTimeStr = '';
                    for (let j = 0; j < 19; j++) {
                      const char = dataView.getUint8(tiffOffset + valueOffset + j);
                      if (char === 0) break;
                      dateTimeStr += String.fromCharCode(char);
                    }
                    
                    // Parse "YYYY:MM:DD HH:MM:SS" format
                    if (dateTimeStr.length === 19) {
                      const parts = dateTimeStr.split(' ');
                      if (parts.length === 2) {
                        const datePart = parts[0].replace(/:/g, '-');
                        const timePart = parts[1];
                        const timestamp = new Date(`${datePart}T${timePart}`);
                        if (!isNaN(timestamp.getTime())) {
                          resolve(timestamp);
                          return;
                        }
                      }
                    }
                  }
                }
              }
              break;
            }
            
            offset += 2 + length;
          }
          
          resolve(null);
        } catch (error) {
          console.warn('EXIF parsing error:', error);
          resolve(null);
        }
      };
      reader.readAsArrayBuffer(file.slice(0, 65536)); // Read first 64KB for EXIF
    });
  }

  /**
   * Process bulk images and group by date with timestamp analysis
   */
  static async processBulkImages(
    files: File[],
    vehicleId: string,
    userId: string
  ): Promise<WorkSessionGroup[]> {
    // Extract timestamps from all images
    const imageMetadata: ImageMetadata[] = [];
    
    for (const file of files) {
      const timestamp = await this.extractImageTimestamp(file);
      imageMetadata.push({
        file,
        fileName: file.name,
        timestamp,
        vehicleId,
        userId
      });
    }

    // Sort by timestamp
    imageMetadata.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    // Group by date
    const groupsByDate = new Map<string, ImageMetadata[]>();
    
    imageMetadata.forEach(img => {
      const dateKey = img.timestamp.toISOString().split('T')[0];
      if (!groupsByDate.has(dateKey)) {
        groupsByDate.set(dateKey, []);
      }
      groupsByDate.get(dateKey)!.push(img);
    });

    // Process each date group to detect work sessions
    const workSessionGroups: WorkSessionGroup[] = [];
    
    for (const [date, images] of groupsByDate) {
      const sessions = this.detectWorkSessions(images, vehicleId, userId);
      const totalDuration = sessions.reduce((sum, session) => sum + session.duration_minutes, 0);
      
      workSessionGroups.push({
        date,
        sessions,
        totalDuration,
        imageCount: images.length,
        images
      });
    }

    return workSessionGroups.sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Detect work sessions from images taken on the same date
   * Uses time gaps to identify start/stop patterns
   */
  private static detectWorkSessions(
    images: ImageMetadata[],
    vehicleId: string,
    userId: string
  ): WorkSession[] {
    if (images.length === 0) {
      return [];
    }

    const sessions: WorkSession[] = [];
    const BREAK_THRESHOLD_MINUTES = 30; // Gap longer than 30 minutes indicates a break
    const MIN_SESSION_MINUTES = 1; // Reduced to 1 minute for rapid photo sequences
    const RAPID_PHOTO_THRESHOLD_SECONDS = 300; // 5 minutes - treat as single work session
    
    // Handle single image or rapid photo sequences
    if (images.length === 1) {
      // Single image - create a minimal work session
      sessions.push({
        id: `session_${Date.now()}_0`,
        vehicle_id: vehicleId,
        user_id: userId,
        session_date: images[0].timestamp.toISOString().split('T')[0],
        start_time: images[0].timestamp.toISOString(),
        end_time: images[0].timestamp.toISOString(),
        duration_minutes: 15, // Default 15 minutes for single photo
        session_type: 'manual',
        confidence_score: 0.7,
        work_description: 'Photo documentation',
        created_at: new Date().toISOString()
      });
      return sessions;
    }

    // Check if all images are within rapid photo threshold (5 minutes)
    const totalSpan = (images[images.length - 1].timestamp.getTime() - images[0].timestamp.getTime()) / 1000;
    if (totalSpan <= RAPID_PHOTO_THRESHOLD_SECONDS) {
      // All photos taken within 5 minutes - treat as single work session
      const estimatedDuration = Math.max(15, Math.round(totalSpan / 60) + 10); // At least 15 minutes
      sessions.push({
        id: `session_${Date.now()}_0`,
        vehicle_id: vehicleId,
        user_id: userId,
        session_date: images[0].timestamp.toISOString().split('T')[0],
        start_time: images[0].timestamp.toISOString(),
        end_time: images[images.length - 1].timestamp.toISOString(),
        duration_minutes: estimatedDuration,
        session_type: 'continuous',
        confidence_score: 0.8,
        work_description: `Photo documentation session (${images.length} photos)`,
        created_at: new Date().toISOString()
      });
      return sessions;
    }

    // Original logic for spaced-out photos
    let sessionStart = images[0];
    let lastImage = images[0];
    
    for (let i = 1; i < images.length; i++) {
      const currentImage = images[i];
      const timeDiff = (currentImage.timestamp.getTime() - lastImage.timestamp.getTime()) / (1000 * 60);
      
      if (timeDiff > BREAK_THRESHOLD_MINUTES) {
        const sessionDuration = (lastImage.timestamp.getTime() - sessionStart.timestamp.getTime()) / (1000 * 60);
        
        if (sessionDuration >= MIN_SESSION_MINUTES) {
          sessions.push({
            id: `session_${Date.now()}_${sessions.length}`,
            vehicle_id: vehicleId,
            user_id: userId,
            session_date: sessionStart.timestamp.toISOString().split('T')[0],
            start_time: sessionStart.timestamp.toISOString(),
            end_time: lastImage.timestamp.toISOString(),
            duration_minutes: Math.round(sessionDuration),
            session_type: 'break_detected',
            confidence_score: this.calculateConfidenceScore(sessionDuration, timeDiff),
            created_at: new Date().toISOString()
          });
        }
        sessionStart = currentImage;
      }
      lastImage = currentImage;
    }
    
    // Handle final session
    const finalSessionDuration = (lastImage.timestamp.getTime() - sessionStart.timestamp.getTime()) / (1000 * 60);
    if (finalSessionDuration >= MIN_SESSION_MINUTES || sessions.length === 0) {
      sessions.push({
        id: `session_${Date.now()}_${sessions.length}`,
        vehicle_id: vehicleId,
        user_id: userId,
        session_date: sessionStart.timestamp.toISOString().split('T')[0],
        start_time: sessionStart.timestamp.toISOString(),
        end_time: lastImage.timestamp.toISOString(),
        duration_minutes: Math.round(finalSessionDuration),
        session_type: sessions.length > 0 ? 'break_detected' : 'continuous',
        confidence_score: this.calculateConfidenceScore(finalSessionDuration, 0),
        created_at: new Date().toISOString()
      });
    }
    
    return sessions;
  }

  /**
   * Calculate confidence score for detected work session
   */
  private static calculateConfidenceScore(sessionDuration: number, breakDuration: number): number {
    let score = 0.5; // Base score
    
    // Longer sessions are more confident
    if (sessionDuration > 60) score += 0.2;
    if (sessionDuration > 120) score += 0.1;
    
    // Clear breaks increase confidence
    if (breakDuration > 60) score += 0.2;
    
    // Cap at 1.0
    return Math.min(1.0, score);
  }

  /**
   * Save work sessions to database
   */
  static async saveWorkSessions(sessions: WorkSession[]): Promise<void> {
    if (sessions.length === 0) return;

    const { error } = await supabase
      .from('work_sessions')
      .insert(sessions);

    if (error) {
      throw new Error(`Failed to save work sessions: ${error.message}`);
    }
  }

  /**
   * Get work sessions for a vehicle
   */
  static async getVehicleWorkSessions(vehicleId: string): Promise<WorkSession[]> {
    const { data, error } = await supabase
      .from('work_sessions')
      .select('*')
      .eq('vehicle_id', vehicleId)
      .order('session_date', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch work sessions: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Get technician work summary for date range
   */
  static async getTechnicianWorkSummary(
    userId: string,
    startDate: string,
    endDate: string
  ): Promise<{
    totalHours: number;
    sessionCount: number;
    vehicleCount: number;
    sessions: WorkSession[];
  }> {
    const { data, error } = await supabase
      .from('work_sessions')
      .select('*')
      .eq('user_id', userId)
      .gte('session_date', startDate)
      .lte('session_date', endDate)
      .order('session_date', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch technician work summary: ${error.message}`);
    }

    const sessions = data || [];
    const totalMinutes = sessions.reduce((sum, session) => sum + session.duration_minutes, 0);
    const uniqueVehicles = new Set(sessions.map(s => s.vehicle_id));

    return {
      totalHours: Math.round((totalMinutes / 60) * 100) / 100,
      sessionCount: sessions.length,
      vehicleCount: uniqueVehicles.size,
      sessions
    };
  }
}
