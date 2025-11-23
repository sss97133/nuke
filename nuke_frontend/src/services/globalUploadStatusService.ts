/**
 * Global Upload Status Service
 * Manages upload and AI processing progress across the entire application
 * Allows navigation during uploads and shows progress in header
 */

export interface UploadJob {
  id: string;
  vehicleId: string;
  totalFiles: number;
  completedFiles: number;
  failedFiles: number;
  startTime: number;
  status: 'uploading' | 'completed' | 'failed';
  errors: string[];
  type: 'upload';
}

export interface ProcessingJob {
  id: string;
  vehicleId: string;
  totalImages: number;
  processedImages: number;
  failedImages: number;
  startTime: number;
  status: 'processing' | 'completed' | 'failed';
  errors: string[];
  type: 'processing';
  imageIds: string[];
}

type Job = UploadJob | ProcessingJob;
type StatusListener = (uploadJobs: UploadJob[], processingJobs: ProcessingJob[]) => void;

class GlobalUploadStatusService {
  private uploadJobs: Map<string, UploadJob> = new Map();
  private processingJobs: Map<string, ProcessingJob> = new Map();
  private listeners: Set<StatusListener> = new Set();

  /**
   * Create a new upload job
   */
  createJob(vehicleId: string, totalFiles: number): string {
    const jobId = `upload-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const job: UploadJob = {
      id: jobId,
      vehicleId,
      totalFiles,
      completedFiles: 0,
      failedFiles: 0,
      startTime: Date.now(),
      status: 'uploading',
      errors: [],
      type: 'upload'
    };

    this.uploadJobs.set(jobId, job);
    this.notifyListeners();
    
    return jobId;
  }

  /**
   * Create a new AI processing job
   */
  createProcessingJob(vehicleId: string, imageIds: string[]): string {
    const jobId = `process-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const job: ProcessingJob = {
      id: jobId,
      vehicleId,
      totalImages: imageIds.length,
      processedImages: 0,
      failedImages: 0,
      startTime: Date.now(),
      status: 'processing',
      errors: [],
      type: 'processing',
      imageIds
    };

    this.processingJobs.set(jobId, job);
    this.notifyListeners();
    
    // Start monitoring AI progress
    this.monitorProcessingJob(jobId);
    
    return jobId;
  }

  /**
   * Update upload job progress
   */
  updateJobProgress(jobId: string, completed: number, failed: number = 0, errors: string[] = []) {
    const job = this.uploadJobs.get(jobId);
    if (!job) return;

    job.completedFiles = completed;
    job.failedFiles = failed;
    job.errors = errors;

    // Check if job is complete
    if (completed + failed >= job.totalFiles) {
      job.status = failed > 0 && failed >= completed ? 'failed' : 'completed';
      
      // Auto-remove completed jobs after 3 seconds
      if (job.status === 'completed') {
        setTimeout(() => {
          this.removeJob(jobId);
        }, 3000);
      }
    }

    this.notifyListeners();
  }

  /**
   * Update processing job progress
   */
  updateProcessingProgress(jobId: string, processed: number, failed: number = 0, errors: string[] = []) {
    const job = this.processingJobs.get(jobId);
    if (!job) return;

    job.processedImages = processed;
    job.failedImages = failed;
    job.errors = errors;

    // Check if job is complete
    if (processed + failed >= job.totalImages) {
      job.status = failed > 0 && failed >= processed ? 'failed' : 'completed';
      
      // Auto-remove completed jobs after 5 seconds
      if (job.status === 'completed') {
        setTimeout(() => {
          this.removeProcessingJob(jobId);
        }, 5000);
      }
    }

    this.notifyListeners();
  }

  /**
   * Monitor AI processing job by polling database
   */
  private async monitorProcessingJob(jobId: string) {
    const job = this.processingJobs.get(jobId);
    if (!job) return;

    // Import supabase dynamically to avoid circular dependency
    const { supabase } = await import('../lib/supabase');

    let pollCount = 0;
    const maxPolls = 60; // 2 minutes max (60 * 2 seconds)

    const checkProgress = async () => {
      const job = this.processingJobs.get(jobId);
      if (!job || job.status !== 'processing') return;

      pollCount++;

      try {
        // Check multiple indicators of AI processing:
        // 1. ai_tags_extracted flag
        // 2. is_sensitive flag being set
        // 3. Any AI tags exist for the image
        const { data: images, error: imgError } = await supabase
          .from('vehicle_images')
          .select('id, ai_tags_extracted, is_sensitive')
          .in('id', job.imageIds);

        if (imgError) {
          console.error('Error fetching image status:', imgError);
          return;
        }

        // Count images that have been processed (either ai_tags or sensitive detection)
        const processed = images?.filter(img => 
          img.ai_tags_extracted === true || img.is_sensitive !== null
        ).length || 0;

        console.log(`[Job ${jobId}] Progress: ${processed}/${job.totalImages} (poll ${pollCount})`);

        this.updateProcessingProgress(jobId, processed);

        // Continue polling if not complete and haven't hit max polls
        if (processed < job.totalImages && pollCount < maxPolls) {
          setTimeout(checkProgress, 2000); // Check every 2 seconds
        } else if (pollCount >= maxPolls) {
          // Timeout - mark remaining as processed to clear the bar
          console.warn(`[Job ${jobId}] Timeout after ${maxPolls} polls, marking complete`);
          this.updateProcessingProgress(jobId, job.totalImages);
        }
      } catch (error) {
        console.error('Error monitoring processing job:', error);
        
        // On error, retry a few times then give up
        if (pollCount < 5) {
          setTimeout(checkProgress, 2000);
        } else {
          console.error('Too many errors, stopping monitoring');
          this.updateProcessingProgress(jobId, job.totalImages);
        }
      }
    };

    // Start checking immediately
    checkProgress();
  }

  /**
   * Remove an upload job
   */
  removeJob(jobId: string) {
    this.uploadJobs.delete(jobId);
    this.notifyListeners();
  }

  /**
   * Remove a processing job
   */
  removeProcessingJob(jobId: string) {
    this.processingJobs.delete(jobId);
    this.notifyListeners();
  }

  /**
   * Get all active upload jobs
   */
  getActiveJobs(): UploadJob[] {
    return Array.from(this.uploadJobs.values()).filter(job => job.status === 'uploading');
  }

  /**
   * Get all active processing jobs
   */
  getActiveProcessingJobs(): ProcessingJob[] {
    return Array.from(this.processingJobs.values()).filter(job => job.status === 'processing');
  }

  /**
   * Get all upload jobs
   */
  getAllJobs(): UploadJob[] {
    return Array.from(this.uploadJobs.values());
  }

  /**
   * Get all processing jobs
   */
  getAllProcessingJobs(): ProcessingJob[] {
    return Array.from(this.processingJobs.values());
  }

  /**
   * Subscribe to status changes
   */
  subscribe(listener: StatusListener): () => void {
    this.listeners.add(listener);
    
    // Return unsubscribe function
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Notify all listeners
   */
  private notifyListeners() {
    const uploadJobs = this.getAllJobs();
    const processingJobs = this.getAllProcessingJobs();
    this.listeners.forEach(listener => listener(uploadJobs, processingJobs));
  }

  /**
   * Calculate estimated time remaining for upload job
   */
  getEstimatedTimeRemaining(jobId: string): number | null {
    const job = this.uploadJobs.get(jobId);
    if (!job || job.completedFiles === 0) return null;

    const elapsedMs = Date.now() - job.startTime;
    const avgTimePerFile = elapsedMs / job.completedFiles;
    const remainingFiles = job.totalFiles - job.completedFiles;
    
    return Math.ceil((avgTimePerFile * remainingFiles) / 1000); // Return in seconds
  }

  /**
   * Calculate estimated time remaining for processing job
   */
  getEstimatedProcessingTime(jobId: string): number | null {
    const job = this.processingJobs.get(jobId);
    if (!job || job.processedImages === 0) return null;

    const elapsedMs = Date.now() - job.startTime;
    const avgTimePerImage = elapsedMs / job.processedImages;
    const remainingImages = job.totalImages - job.processedImages;
    
    return Math.ceil((avgTimePerImage * remainingImages) / 1000); // Return in seconds
  }

  /**
   * Format time as mm:ss
   */
  formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }
}

// Export singleton instance
export const globalUploadStatusService = new GlobalUploadStatusService();

