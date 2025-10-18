/**
 * Global Upload Queue Manager
 * 
 * CONSOLIDATED: Now uses ImageUploadService for consistent upload handling.
 * Handles background uploads across multiple vehicle profiles.
 * Persists upload state across navigation.
 */

import { ImageUploadService } from './imageUploadService';

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

  // Process single upload using consolidated ImageUploadService
  private async processUpload(item: UploadItem) {
    this.activeUploads++;
    item.status = 'uploading';
    this.notifyListeners();
    
    try {
      // Use consolidated ImageUploadService which handles:
      // - EXIF extraction (date, GPS, camera)
      // - Multi-resolution variants
      // - Storage upload
      // - Database insertion with taken_at
      // - Timeline event creation with EXIF date
      // - User contribution logging
      item.progress = 25;
      this.notifyListeners();
      
      const result = await ImageUploadService.uploadImage(
        item.vehicleId,
        item.file,
        'general'
      );
      
      if (!result.success) {
        throw new Error(result.error || 'Upload failed');
      }
      
      item.progress = 75;
      this.notifyListeners();
      
      // Note: ImageUploadService already creates individual timeline events
      // We don't need to create duplicate events here
      
      item.status = 'completed';
      item.progress = 100;
      
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
