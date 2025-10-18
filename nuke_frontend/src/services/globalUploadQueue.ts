// Global Upload Queue Manager
// Handles background uploads across multiple vehicle profiles
// Persists upload state across navigation

import { supabase } from '../lib/supabase';
import { TimelineEventService } from './timelineEventService';
import { ExifExtractor } from '../utils/exifExtractor';
import { WorkSessionService } from './workSessionService';

interface UploadItem {
  id: string;
  vehicleId: string;
  vehicleName: string;
  file: File;
  status: 'pending' | 'uploading' | 'completed' | 'failed';
  progress: number;
  error?: string;
}

class GlobalUploadQueue {
  private queue: UploadItem[] = [];
  private isProcessing = false;
  private listeners: Set<(queue: UploadItem[]) => void> = new Set();
  private activeUploads = 0;
  private maxConcurrent = 3; // Upload 3 files at a time
  private uploadedPhotos: Map<string, Array<{ file: File; imageUrl: string; dateTaken: Date; gps: any }>> = new Map();

  // Add files to queue for a specific vehicle
  addFiles(vehicleId: string, vehicleName: string, files: File[]) {
    const newItems: UploadItem[] = files.map(file => ({
      id: crypto.randomUUID(),
      vehicleId,
      vehicleName,
      file,
      status: 'pending' as const,
      progress: 0
    }));
    
    this.queue.push(...newItems);
    this.notifyListeners();
    this.processQueue();
  }

  // Subscribe to queue updates
  subscribe(listener: (queue: UploadItem[]) => void) {
    this.listeners.add(listener);
    // Immediately notify with current state
    listener(this.queue);
    
    // Return unsubscribe function
    return () => {
      this.listeners.delete(listener);
    };
  }

  // Get current queue state
  getQueue() {
    return [...this.queue];
  }

  // Get uploads for specific vehicle
  getVehicleUploads(vehicleId: string) {
    return this.queue.filter(item => item.vehicleId === vehicleId);
  }

  // Get count of active uploads
  getActiveCount() {
    return this.queue.filter(item => 
      item.status === 'pending' || item.status === 'uploading'
    ).length;
  }

  // Process the upload queue
  private async processQueue() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    while (this.queue.some(item => item.status === 'pending') && this.activeUploads < this.maxConcurrent) {
      const nextItem = this.queue.find(item => item.status === 'pending');
      if (!nextItem) break;
      
      // Process the upload (don't await to allow concurrent uploads)
      this.processUpload(nextItem);
    }

    this.isProcessing = false;
  }

  // Get current user
  private async getCurrentUser() {
    const { data: { user } } = await supabase.auth.getUser();
    return user;
  }

  // Process single upload
  private async processUpload(item: UploadItem) {
    this.activeUploads++;
    item.status = 'uploading';
    this.notifyListeners();
    
    try {
      const user = await this.getCurrentUser();
      if (!user) throw new Error('No authenticated user');
      
      // Extract GPS and EXIF data before upload
      const exifData = await ExifExtractor.extractAll(item.file);
      console.log(`Extracted GPS for ${item.file.name}:`, exifData.gps);
      
      // Generate unique filename
      const timestamp = Date.now();
      const randomString = Math.random().toString(36).substring(2, 8);
      const fileExt = item.file.name.split('.').pop();
      const fileName = `${timestamp}_${randomString}.${fileExt}`;
      const filePath = `vehicles/${item.vehicleId}/images/${fileName}`;
      
      // Upload to Supabase Storage
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('vehicle-data')
        .upload(filePath, item.file);
      
      // Update progress manually since Supabase doesn't support progress tracking
      item.progress = 50;
      
      if (uploadError) throw uploadError;
      
      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('vehicle-data')
        .getPublicUrl(filePath);
      
      // Save to database with GPS coordinates
      const { error: dbError } = await supabase
        .from('vehicle_images')
        .insert({
          vehicle_id: item.vehicleId,
          image_url: publicUrl,
          file_name: item.file.name,
          file_size: item.file.size,
          mime_type: item.file.type,
          storage_path: filePath,
          user_id: user.id,
          latitude: exifData.gps.latitude,
          longitude: exifData.gps.longitude,
          exif_data: {
            dateTaken: exifData.dateTaken,
            camera: exifData.camera,
            orientation: exifData.orientation
          }
        });
      
      if (dbError) throw dbError;
      
      // Track uploaded photo for work session detection
      if (!this.uploadedPhotos.has(item.vehicleId)) {
        this.uploadedPhotos.set(item.vehicleId, []);
      }
      // Parse date safely from EXIF or file metadata
      let photoDate: Date;
      if (exifData.dateTaken) {
        photoDate = new Date(exifData.dateTaken);
        // Validate the date
        if (isNaN(photoDate.getTime())) {
          photoDate = new Date(item.file.lastModified || Date.now());
        }
      } else {
        photoDate = new Date(item.file.lastModified || Date.now());
      }
      
      this.uploadedPhotos.get(item.vehicleId)!.push({
        file: item.file,
        imageUrl: publicUrl,
        dateTaken: photoDate,
        gps: exifData.gps
      });
      
      item.status = 'completed';
      item.progress = 100;
      
      // Check if all uploads for this vehicle are complete
      const vehicleUploads = this.queue.filter(q => q.vehicleId === item.vehicleId);
      const allComplete = vehicleUploads.every(q => q.status === 'completed' || q.status === 'failed');
      
      if (allComplete) {
        // Detect work sessions from uploaded photos
        const photos = this.uploadedPhotos.get(item.vehicleId) || [];
        if (photos.length > 0) {
          try {
            // Sort photos by date
            const sortedPhotos = photos.sort((a, b) => a.dateTaken.getTime() - b.dateTaken.getTime());
            
            // Detect work sessions using time gaps (30 min threshold)
            const sessions: Array<typeof photos> = [];
            let currentSession: typeof photos = [sortedPhotos[0]];
            const GAP_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
            
            for (let i = 1; i < sortedPhotos.length; i++) {
              const timeDiff = sortedPhotos[i].dateTaken.getTime() - sortedPhotos[i-1].dateTaken.getTime();
              
              if (timeDiff > GAP_THRESHOLD_MS) {
                // Gap detected - start new session
                sessions.push(currentSession);
                currentSession = [sortedPhotos[i]];
              } else {
                currentSession.push(sortedPhotos[i]);
              }
            }
            sessions.push(currentSession); // Add final session
            
            // Create one timeline event per work session
            for (const session of sessions) {
              const sessionDate = session[0].dateTaken;
              const sessionDuration = session.length > 1 
                ? (session[session.length - 1].dateTaken.getTime() - session[0].dateTaken.getTime()) / (1000 * 60)
                : 15; // Default 15 min for single photo
              
              const hasGPS = session.some(p => p.gps?.latitude && p.gps?.longitude);
              
              await TimelineEventService.createImageUploadEvent(
                item.vehicleId,
                {
                  fileName: `Work session - ${session.length} photos`,
                  fileSize: session.reduce((sum, p) => sum + p.file.size, 0),
                  imageUrl: session[0].imageUrl,
                  dateTaken: sessionDate,
                  gps: hasGPS ? session.find(p => p.gps?.latitude)?.gps : null,
                  metadata: {
                    photo_count: session.length,
                    duration_minutes: Math.round(sessionDuration),
                    start_time: !isNaN(session[0].dateTaken.getTime()) ? session[0].dateTaken.toISOString() : new Date().toISOString(),
                    end_time: !isNaN(session[session.length - 1].dateTaken.getTime()) ? session[session.length - 1].dateTaken.toISOString() : new Date().toISOString(),
                    image_urls: session.map(p => p.imageUrl)
                  }
                }
              );
            }
            
            console.log(`Created ${sessions.length} work session events from ${photos.length} photos`);
          } catch (error) {
            console.error('Failed to create work session timeline events:', error);
          }
          
          // Clear tracked photos for this vehicle
          this.uploadedPhotos.delete(item.vehicleId);
        }
      }
      
      // Notify that images were updated for this vehicle
      window.dispatchEvent(new CustomEvent('vehicle_images_updated', { 
        detail: { vehicleId: item.vehicleId } 
      }));
      
    } catch (error) {
      console.error('Upload failed:', error);
      item.status = 'failed';
      item.error = error instanceof Error ? error.message : 'Upload failed';
    } finally {
      this.activeUploads--;
      this.notifyListeners();
      
      // Remove completed/failed items after 10 seconds
      if (item.status === 'completed' || item.status === 'failed') {
        setTimeout(() => {
          this.removeItem(item.id);
        }, 10000);
      }
      
      // Continue processing queue
      this.processQueue();
    }
  }

  // Remove item from queue
  private removeItem(id: string) {
    this.queue = this.queue.filter(item => item.id !== id);
    this.notifyListeners();
  }

  // Clear completed items
  clearCompleted() {
    this.queue = this.queue.filter(item => 
      item.status !== 'completed' && item.status !== 'failed'
    );
    this.notifyListeners();
  }

  // Notify all listeners of queue changes
  private notifyListeners() {
    this.listeners.forEach(listener => listener(this.queue));
  }
}

// Create singleton instance
export const uploadQueue = new GlobalUploadQueue();
