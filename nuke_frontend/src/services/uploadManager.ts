// Global Upload Manager - Persists across page navigation
import { supabase } from '../lib/supabase';

export interface UploadTask {
  id: string;
  vehicleId: string;
  vehicleName: string;
  files: File[];
  totalSize: number;
  uploadedSize: number;
  uploadedCount: number;
  totalCount: number;
  status: 'queued' | 'uploading' | 'completed' | 'failed' | 'paused';
  error?: string;
  startTime: number;
  endTime?: number;
}

class UploadManager {
  private static instance: UploadManager;
  private uploads: Map<string, UploadTask> = new Map();
  private activeUpload: string | null = null;
  private listeners: Set<(uploads: UploadTask[]) => void> = new Set();
  private uploadWorker: Worker | null = null;

  private constructor() {
    // No longer persisting uploads locally - all upload state is managed in memory
    // Uploads will restart fresh on page reload for better reliability
  }

  static getInstance(): UploadManager {
    if (!UploadManager.instance) {
      UploadManager.instance = new UploadManager();
    }
    return UploadManager.instance;
  }

  // Add a new upload task
  addUpload(vehicleId: string, vehicleName: string, files: File[]): string {
    const uploadId = crypto.randomUUID();
    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    
    const task: UploadTask = {
      id: uploadId,
      vehicleId,
      vehicleName,
      files,
      totalSize,
      uploadedSize: 0,
      uploadedCount: 0,
      totalCount: files.length,
      status: 'queued',
      startTime: Date.now()
    };
    
    this.uploads.set(uploadId, task);
    this.notifyListeners();
    
    // Start processing if no active upload
    if (!this.activeUpload) {
      this.processNextUpload();
    }
    
    return uploadId;
  }

  // Process uploads in queue
  private async processNextUpload() {
    const queuedUploads = Array.from(this.uploads.values())
      .filter(u => u.status === 'queued');
    
    if (queuedUploads.length === 0) {
      this.activeUpload = null;
      return;
    }
    
    const nextUpload = queuedUploads[0];
    this.activeUpload = nextUpload.id;
    nextUpload.status = 'uploading';
    this.notifyListeners();
    
    try {
      await this.uploadFiles(nextUpload);
      nextUpload.status = 'completed';
      nextUpload.endTime = Date.now();
    } catch (error) {
      nextUpload.status = 'failed';
      nextUpload.error = error instanceof Error ? error.message : 'Upload failed';
    }
    
    this.notifyListeners();
    
    // Process next upload
    setTimeout(() => this.processNextUpload(), 1000);
  }

  // Upload files for a task
  private async uploadFiles(task: UploadTask) {
    const BATCH_SIZE = 5; // Upload 5 files at a time
    
    for (let i = 0; i < task.files.length; i += BATCH_SIZE) {
      const batch = task.files.slice(i, Math.min(i + BATCH_SIZE, task.files.length));
      
      await Promise.all(batch.map(async (file) => {
        try {
          const fileName = `${task.vehicleId}/${crypto.randomUUID()}.${file.name.split('.').pop()}`;
          
          const { error } = await supabase.storage
            .from('vehicle-images')
            .upload(fileName, file, {
              cacheControl: '3600',
              upsert: false
            });
          
          if (error) throw error;
          
          task.uploadedSize += file.size;
          task.uploadedCount++;
          this.notifyListeners();
        } catch (error) {
          console.error('Failed to upload file:', file.name, error);
          // Continue with other files even if one fails
        }
      }));
      
      // Update progress
    }
  }

  // Pause an upload
  pauseUpload(uploadId: string) {
    const upload = this.uploads.get(uploadId);
    if (upload && upload.status === 'uploading') {
      upload.status = 'paused';
      this.notifyListeners();
      
      if (this.activeUpload === uploadId) {
        this.activeUpload = null;
        this.processNextUpload();
      }
    }
  }

  // Resume a paused upload
  resumeUpload(uploadId: string) {
    const upload = this.uploads.get(uploadId);
    if (upload && upload.status === 'paused') {
      upload.status = 'queued';
      this.notifyListeners();
      
      if (!this.activeUpload) {
        this.processNextUpload();
      }
    }
  }

  // Cancel an upload
  cancelUpload(uploadId: string) {
    this.uploads.delete(uploadId);
    this.notifyListeners();
    
    if (this.activeUpload === uploadId) {
      this.activeUpload = null;
      this.processNextUpload();
    }
  }

  // Clear completed uploads
  clearCompleted() {
    const completed = Array.from(this.uploads.values())
      .filter(u => u.status === 'completed')
      .map(u => u.id);
    
    completed.forEach(id => this.uploads.delete(id));
    this.notifyListeners();
  }

  // Get all uploads
  getUploads(): UploadTask[] {
    return Array.from(this.uploads.values());
  }

  // Get upload by ID
  getUpload(uploadId: string): UploadTask | undefined {
    return this.uploads.get(uploadId);
  }

  // Subscribe to upload changes
  subscribe(listener: (uploads: UploadTask[]) => void): () => void {
    this.listeners.add(listener);
    listener(this.getUploads()); // Initial call
    
    return () => {
      this.listeners.delete(listener);
    };
  }

  // Notify all listeners
  private notifyListeners() {
    const uploads = this.getUploads();
    this.listeners.forEach(listener => listener(uploads));
  }

  // Resume any interrupted uploads
  private resumeUploads() {
    if (!this.activeUpload) {
      this.processNextUpload();
    }
  }

  // Get upload progress percentage
  getProgress(uploadId: string): number {
    const upload = this.uploads.get(uploadId);
    if (!upload) return 0;
    
    if (upload.totalSize === 0) return 0;
    return Math.round((upload.uploadedSize / upload.totalSize) * 100);
  }

  // Get overall progress
  getOverallProgress(): { active: number; queued: number; completed: number } {
    const uploads = this.getUploads();
    return {
      active: uploads.filter(u => u.status === 'uploading').length,
      queued: uploads.filter(u => u.status === 'queued').length,
      completed: uploads.filter(u => u.status === 'completed').length
    };
  }
}

export const uploadManager = UploadManager.getInstance();
