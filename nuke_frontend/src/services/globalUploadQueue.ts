/**
 * Global Upload Queue Manager
 * 
 * CONSOLIDATED: Now uses ImageUploadService for consistent upload handling.
 * Handles background uploads across multiple vehicle profiles.
 * Persists upload state across navigation and crashes.
 * Prevents duplicate uploads using file fingerprints.
 */

import { ImageUploadService } from './imageUploadService';
import { supabase } from '../lib/supabase';

interface UploadItem {
  id: string;
  vehicleId: string;
  vehicleName: string;
  file: File;
  status: 'pending' | 'uploading' | 'completed' | 'failed';
  progress: number;
  error?: string;
  fingerprint: string; // Unique identifier: filename + size + lastModified
  addedAt: number; // Timestamp when added to queue
}

interface PersistedQueueItem {
  id: string;
  vehicleId: string;
  vehicleName: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  status: 'pending' | 'uploading' | 'completed' | 'failed';
  progress: number;
  error?: string;
  fingerprint: string;
  addedAt: number;
}

class GlobalUploadQueue {
  private queue: UploadItem[] = [];
  private isProcessing = false;
  private listeners: Set<(queue: UploadItem[]) => void> = new Set();
  private activeUploads = 0;
  private maxConcurrent = 3; // Upload 3 files at a time
  private readonly STORAGE_KEY = 'nuke_upload_queue';
  private readonly MAX_QUEUE_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
  private uploadedFingerprints = new Set<string>(); // Track uploaded files to prevent duplicates

  constructor() {
    // Load persisted queue on startup
    this.loadPersistedQueue();
    // Load uploaded fingerprints from database
    this.loadUploadedFingerprints();
  }

  // Generate fingerprint for file (used for duplicate detection)
  private generateFingerprint(file: File): string {
    return `${file.name}_${file.size}_${file.lastModified}`;
  }

  // Load fingerprints of already uploaded images from database
  private async loadUploadedFingerprints() {
    try {
      // Get all vehicle images from last 30 days to check for duplicates
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const { data: recentImages } = await supabase
        .from('vehicle_images')
        .select('original_filename, file_size, taken_at')
        .gte('uploaded_at', thirtyDaysAgo.toISOString());
      
      if (recentImages) {
        recentImages.forEach(img => {
          if (img.original_filename && img.file_size) {
            // Create fingerprint from stored metadata
            const takenTimestamp = img.taken_at ? new Date(img.taken_at).getTime() : 0;
            const fingerprint = `${img.original_filename}_${img.file_size}_${takenTimestamp}`;
            this.uploadedFingerprints.add(fingerprint);
          }
        });
        console.log(`Loaded ${this.uploadedFingerprints.size} uploaded file fingerprints for duplicate detection`);
      }
    } catch (error) {
      console.error('Failed to load uploaded fingerprints:', error);
    }
  }

  // Load persisted queue from localStorage
  private loadPersistedQueue() {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (!stored) return;
      
      const persisted: PersistedQueueItem[] = JSON.parse(stored);
      const now = Date.now();
      
      // Filter out old items and mark stale uploads as failed
      const validItems = persisted.filter(item => {
        const age = now - item.addedAt;
        if (age > this.MAX_QUEUE_AGE_MS) {
          console.log(`Discarding stale queue item: ${item.fileName} (${Math.round(age / 1000 / 60 / 60)} hours old)`);
          return false;
        }
        return true;
      });
      
      // Mark any 'uploading' items as 'pending' (they were interrupted)
      validItems.forEach(item => {
        if (item.status === 'uploading') {
          item.status = 'pending';
          item.progress = 0;
          item.error = 'Upload interrupted - will retry';
        }
      });
      
      if (validItems.length > 0) {
        console.log(`Recovered ${validItems.length} items from upload queue`);
        // Note: We can't restore File objects, so these will remain in 'pending' state
        // User will need to re-add files if they want to resume
        this.saveToStorage();
      }
      
    } catch (error) {
      console.error('Failed to load persisted queue:', error);
      localStorage.removeItem(this.STORAGE_KEY);
    }
  }

  // Save queue to localStorage (without File objects)
  private saveToStorage() {
    try {
      const persisted: PersistedQueueItem[] = this.queue.map(item => ({
        id: item.id,
        vehicleId: item.vehicleId,
        vehicleName: item.vehicleName,
        fileName: item.file.name,
        fileSize: item.file.size,
        fileType: item.file.type,
        status: item.status,
        progress: item.progress,
        error: item.error,
        fingerprint: item.fingerprint,
        addedAt: item.addedAt
      }));
      
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(persisted));
    } catch (error) {
      console.error('Failed to persist queue:', error);
    }
  }

  // Add files to queue for a specific vehicle with duplicate detection
  addFiles(vehicleId: string, vehicleName: string, files: File[]) {
    const newItems: UploadItem[] = [];
    const duplicates: string[] = [];
    const alreadyQueued: string[] = [];
    
    files.forEach(file => {
      const fingerprint = this.generateFingerprint(file);
      
      // Check if already uploaded to database
      if (this.uploadedFingerprints.has(fingerprint)) {
        duplicates.push(file.name);
        return;
      }
      
      // Check if already in queue
      if (this.queue.some(item => item.fingerprint === fingerprint && item.vehicleId === vehicleId)) {
        alreadyQueued.push(file.name);
        return;
      }
      
      newItems.push({
        id: crypto.randomUUID(),
        vehicleId,
        vehicleName,
        file,
        status: 'pending' as const,
        progress: 0,
        fingerprint,
        addedAt: Date.now()
      });
    });
    
    // Show user feedback about duplicates
    if (duplicates.length > 0) {
      console.warn(`Skipped ${duplicates.length} duplicate files (already uploaded):`, duplicates.slice(0, 5));
      if (duplicates.length <= 5) {
        alert(`Skipped ${duplicates.length} duplicate image(s) that were already uploaded:\n\n${duplicates.join('\n')}`);
      } else {
        alert(`Skipped ${duplicates.length} duplicate images that were already uploaded.\n\nFirst few: ${duplicates.slice(0, 3).join(', ')}...`);
      }
    }
    
    if (alreadyQueued.length > 0) {
      console.warn(`Skipped ${alreadyQueued.length} files already in upload queue:`, alreadyQueued);
    }
    
    if (newItems.length === 0) {
      if (duplicates.length === 0 && alreadyQueued.length === 0) {
        console.warn('No new files to add to queue');
      }
      return;
    }
    
    this.queue.push(...newItems);
    this.saveToStorage();
    this.notifyListeners();
    this.processQueue();
    
    console.log(`Added ${newItems.length} new files to upload queue (skipped ${duplicates.length} duplicates, ${alreadyQueued.length} already queued)`);
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
    this.saveToStorage(); // Persist state change
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
      this.saveToStorage();
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
      this.saveToStorage();
      this.notifyListeners();
      
      // Note: ImageUploadService already creates individual timeline events
      // We don't need to create duplicate events here
      
      item.status = 'completed';
      item.progress = 100;
      
      // Add to uploaded fingerprints to prevent re-upload
      this.uploadedFingerprints.add(item.fingerprint);
      console.log(`✓ Uploaded: ${item.file.name} (fingerprint cached for duplicate detection)`);
      
      this.saveToStorage();
      
      // Notify that images were updated for this vehicle
      window.dispatchEvent(new CustomEvent('vehicle_images_updated', { 
        detail: { vehicleId: item.vehicleId } 
      }));
      
    } catch (error) {
      console.error('Upload failed:', error);
      item.status = 'failed';
      item.error = error instanceof Error ? error.message : 'Upload failed';
      this.saveToStorage();
    } finally {
      this.activeUploads--;
      this.notifyListeners();
      
      // Remove completed/failed items after 30 seconds (longer to see success/failure)
      if (item.status === 'completed' || item.status === 'failed') {
        setTimeout(() => {
          this.removeItem(item.id);
        }, 30000);
      }
      
      // Continue processing queue
      this.processQueue();
    }
  }

  // Remove item from queue
  private removeItem(id: string) {
    this.queue = this.queue.filter(item => item.id !== id);
    this.saveToStorage();
    this.notifyListeners();
  }

  // Clear completed items
  clearCompleted() {
    this.queue = this.queue.filter(item => 
      item.status !== 'completed' && item.status !== 'failed'
    );
    this.saveToStorage();
    this.notifyListeners();
  }

  // Retry failed uploads
  retryFailed() {
    let retried = 0;
    this.queue.forEach(item => {
      if (item.status === 'failed') {
        item.status = 'pending';
        item.progress = 0;
        item.error = undefined;
        retried++;
      }
    });
    
    if (retried > 0) {
      console.log(`Retrying ${retried} failed uploads`);
      this.saveToStorage();
      this.notifyListeners();
      this.processQueue();
    }
  }

  // Notify all listeners of queue changes
  private notifyListeners() {
    this.listeners.forEach(listener => listener(this.queue));
  }
}

// Create singleton instance
export const uploadQueue = new GlobalUploadQueue();
