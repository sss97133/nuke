/**
 * Global Upload Queue Manager
 *
 * CONSOLIDATED: Now uses ImageUploadService for consistent upload handling.
 * Handles background uploads across multiple vehicle profiles.
 * Persists upload state across navigation and crashes.
 * Prevents duplicate uploads using file fingerprints.
 *
 * DURABILITY: queue items (including File blobs — they are structured-cloneable)
 * are persisted to IndexedDB at enqueue time and restored on next app launch,
 * so uploads survive tab close, crashes, and offline periods. localStorage
 * (which could not hold File objects, so "recovered" items were unresumable)
 * is no longer used.
 */

import toast from 'react-hot-toast';
import { ImageUploadService } from './imageUploadService';
import { supabase } from '../lib/supabase';

interface UploadItem {
  id: string;
  /** null = personal library ("photo inbox") — server pipeline resolves the vehicle */
  vehicleId: string | null;
  vehicleName: string;
  file: File;
  status: 'pending' | 'uploading' | 'completed' | 'failed';
  progress: number;
  error?: string;
  fingerprint: string; // Unique identifier: filename + size + lastModified
  addedAt: number; // Timestamp when added to queue
  attempts: number; // Upload attempts (for retry backoff)
}

class GlobalUploadQueue {
  private queue: UploadItem[] = [];
  private isProcessing = false;
  private listeners: Set<(queue: UploadItem[]) => void> = new Set();
  private activeUploads = 0;
  private maxConcurrent = 3; // Upload 3 files at a time
  private readonly MAX_QUEUE_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
  private readonly MAX_ATTEMPTS = 3;
  private readonly DB_NAME = 'nuke_global_uploads';
  private readonly DB_STORE = 'queue';
  private dbPromise: Promise<IDBDatabase | null> | null = null;
  private uploadedFingerprints = new Set<string>(); // Track uploaded files to prevent duplicates

  constructor() {
    // Restore persisted queue (IndexedDB) and resume interrupted uploads
    void this.restoreQueue();
    // Load uploaded fingerprints from database
    this.loadUploadedFingerprints();

    if (typeof window !== 'undefined') {
      // Connection returned — resume pending uploads
      window.addEventListener('online', () => this.processQueue());
      // One-time cleanup of the legacy localStorage queue (metadata-only, unresumable)
      try { window.localStorage.removeItem('nuke_upload_queue'); } catch { /* ignore */ }
    }
  }

  // ── IndexedDB persistence ──────────────────────────────────────────────

  private openDb(): Promise<IDBDatabase | null> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve) => {
      try {
        if (typeof indexedDB === 'undefined') { resolve(null); return; }
        const req = indexedDB.open(this.DB_NAME, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(this.DB_STORE)) {
            db.createObjectStore(this.DB_STORE, { keyPath: 'id' });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => {
          console.warn('Upload queue: IndexedDB unavailable, uploads will not survive page close');
          resolve(null);
        };
      } catch {
        resolve(null);
      }
    });
    return this.dbPromise;
  }

  /** Persist (upsert) an item — including its File blob — so it survives page close. */
  private async persistItem(item: UploadItem) {
    try {
      const db = await this.openDb();
      if (!db) return;
      const tx = db.transaction([this.DB_STORE], 'readwrite');
      tx.objectStore(this.DB_STORE).put({
        id: item.id,
        vehicleId: item.vehicleId,
        vehicleName: item.vehicleName,
        file: item.file,
        status: item.status,
        error: item.error,
        fingerprint: item.fingerprint,
        addedAt: item.addedAt,
        attempts: item.attempts,
      });
    } catch (error) {
      console.warn('Upload queue: failed to persist item (non-blocking):', error);
    }
  }

  private async unpersistItem(id: string) {
    try {
      const db = await this.openDb();
      if (!db) return;
      const tx = db.transaction([this.DB_STORE], 'readwrite');
      tx.objectStore(this.DB_STORE).delete(id);
    } catch { /* non-blocking */ }
  }

  /** Restore queued uploads from IndexedDB on app launch and resume them. */
  private async restoreQueue() {
    try {
      const db = await this.openDb();
      if (!db) return;
      const records: any[] = await new Promise((resolve, reject) => {
        const tx = db.transaction([this.DB_STORE], 'readonly');
        const req = tx.objectStore(this.DB_STORE).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
      if (records.length === 0) return;

      const now = Date.now();
      let restored = 0;
      for (const rec of records) {
        const age = now - (rec.addedAt || 0);
        const fileOk = rec.file instanceof Blob;
        if (age > this.MAX_QUEUE_AGE_MS || !fileOk || rec.status === 'completed') {
          void this.unpersistItem(rec.id);
          continue;
        }
        if (this.queue.some((item) => item.id === rec.id)) continue;
        // Out-of-budget items come back as 'failed' (visible, manually retryable)
        // instead of looping one doomed attempt per app launch.
        const exhausted = (rec.attempts || 0) >= this.MAX_ATTEMPTS;
        this.queue.push({
          id: rec.id,
          vehicleId: rec.vehicleId ?? null,
          vehicleName: rec.vehicleName || 'Vehicle',
          file: rec.file as File,
          status: exhausted ? 'failed' : 'pending',
          progress: 0,
          error: exhausted ? (rec.error || 'Upload failed') : undefined,
          fingerprint: rec.fingerprint,
          addedAt: rec.addedAt || now,
          attempts: rec.attempts || 0,
        });
        if (!exhausted) restored++;
      }
      this.notifyListeners();
      if (restored === 0) return;

      console.log(`Upload queue: restored ${restored} interrupted upload(s) from IndexedDB`);

      // Uploads need an authenticated session — wait for auth to settle.
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        toast(`Resuming ${restored} interrupted upload(s)…`, { icon: '↑' });
        this.processQueue();
      } else {
        const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
          if (s) {
            sub.subscription.unsubscribe();
            this.processQueue();
          }
        });
      }
    } catch (error) {
      console.warn('Upload queue: restore failed:', error);
    }
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
        .select('filename, file_size, taken_at')
        .gte('created_at', thirtyDaysAgo.toISOString());
      
      if (recentImages) {
        recentImages.forEach(img => {
          if (img.filename && img.file_size) {
            // Create fingerprint from stored metadata
            const takenTimestamp = img.taken_at ? new Date(img.taken_at).getTime() : 0;
            const fingerprint = `${img.filename}_${img.file_size}_${takenTimestamp}`;
            this.uploadedFingerprints.add(fingerprint);
          }
        });
      }
    } catch (error) {
      console.error('Failed to load uploaded fingerprints:', error);
    }
  }

  // Add files to queue for a specific vehicle (or the personal library when
  // vehicleId is null) with duplicate detection
  addFiles(vehicleId: string | null, vehicleName: string, files: File[]) {
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
        addedAt: Date.now(),
        attempts: 0
      });
    });

    // Show user feedback about duplicates
    if (duplicates.length > 0) {
      console.warn(`Skipped ${duplicates.length} duplicate files (already uploaded):`, duplicates.slice(0, 5));
      toast(`Skipped ${duplicates.length} duplicate image(s) already uploaded`, { icon: '⏭' });
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
    // Persist blobs immediately — from here on the upload survives tab close
    newItems.forEach((item) => void this.persistItem(item));
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
    // Offline: leave everything pending; the 'online' listener resumes us.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
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
    item.attempts += 1;
    void this.persistItem(item); // Persist state change
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
        item.vehicleId || undefined,
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

      // Add to uploaded fingerprints to prevent re-upload
      this.uploadedFingerprints.add(item.fingerprint);
      console.log(`✓ Uploaded: ${item.file.name} (fingerprint cached for duplicate detection)`);

      // Done — drop the persisted blob
      void this.unpersistItem(item.id);

      // Notify that images were updated for this vehicle
      window.dispatchEvent(new CustomEvent('vehicle_images_updated', {
        detail: { vehicleId: item.vehicleId }
      }));

    } catch (error) {
      const wentOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
      if (wentOffline || item.attempts < this.MAX_ATTEMPTS) {
        // Transient: back to pending. Offline items resume via the 'online'
        // listener; online failures retry with exponential backoff.
        console.warn(`Upload ${wentOffline ? 'paused (offline)' : `failed (attempt ${item.attempts}/${this.MAX_ATTEMPTS})`}: ${item.file.name}`);
        item.status = 'pending';
        item.progress = 0;
        void this.persistItem(item);
        if (!wentOffline) {
          setTimeout(() => this.processQueue(), 1000 * Math.pow(2, item.attempts));
        }
      } else {
        console.error('Upload failed permanently:', error);
        item.status = 'failed';
        item.error = error instanceof Error ? error.message : 'Upload failed';
        void this.persistItem(item);
      }
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
    void this.unpersistItem(id);
    this.notifyListeners();
  }

  // Clear completed items
  clearCompleted() {
    this.queue.forEach(item => {
      if (item.status === 'completed' || item.status === 'failed') {
        void this.unpersistItem(item.id);
      }
    });
    this.queue = this.queue.filter(item =>
      item.status !== 'completed' && item.status !== 'failed'
    );
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
        item.attempts = 0;
        void this.persistItem(item);
        retried++;
      }
    });

    if (retried > 0) {
      console.log(`Retrying ${retried} failed uploads`);
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
