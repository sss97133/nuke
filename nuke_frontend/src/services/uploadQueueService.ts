/**
 * Upload Queue Service
 * Persists file selections in IndexedDB and allows resume without re-selection
 */

interface QueuedFile {
  id: string;
  name: string;
  size: number;
  type: string;
  vehicleId: string;
  status: 'pending' | 'uploading' | 'completed' | 'failed';
  error?: string;
  imageId?: string;
  file?: File; // Actual File object (persisted in IndexedDB)
}

class UploadQueueService {
  private dbName = 'nuke_upload_queue';
  private storeName = 'files';
  private db: IDBDatabase | null = null;

  async init() {
    if (this.db) return;

    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
          store.createIndex('vehicleId', 'vehicleId', { unique: false });
          store.createIndex('status', 'status', { unique: false });
        }
      };
    });
  }

  /**
   * Add files to upload queue
   */
  async addFiles(vehicleId: string, files: FileList | File[]): Promise<void> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    const transaction = this.db.transaction([this.storeName], 'readwrite');
    const store = transaction.objectStore(this.storeName);

    const fileArray = Array.from(files);
    
    for (const file of fileArray) {
      const queuedFile: QueuedFile = {
        id: `${vehicleId}_${file.name}_${file.size}_${Date.now()}`,
        name: file.name,
        size: file.size,
        type: file.type,
        vehicleId,
        status: 'pending',
        file // Store the actual File object
      };

      store.put(queuedFile);
    }

    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  /**
   * Get pending files for a vehicle
   */
  async getPendingFiles(vehicleId: string): Promise<QueuedFile[]> {
    await this.init();
    if (!this.db) return [];

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const index = store.index('vehicleId');
      const request = index.getAll(vehicleId);

      request.onsuccess = () => {
        const allFiles = request.result as QueuedFile[];
        const pending = allFiles.filter(f => f.status === 'pending' || f.status === 'failed');
        resolve(pending);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Update file status
   */
  async updateStatus(fileId: string, status: QueuedFile['status'], data?: Partial<QueuedFile>): Promise<void> {
    await this.init();
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.get(fileId);

      request.onsuccess = () => {
        const file = request.result as QueuedFile;
        if (file) {
          file.status = status;
          if (data) {
            Object.assign(file, data);
          }
          store.put(file);
        }
      };

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  /**
   * Clear completed files for a vehicle
   */
  async clearCompleted(vehicleId: string): Promise<void> {
    await this.init();
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const index = store.index('vehicleId');
      const request = index.openCursor(vehicleId);

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          const file = cursor.value as QueuedFile;
          if (file.status === 'completed') {
            cursor.delete();
          }
          cursor.continue();
        }
      };

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  /**
   * Get queue stats
   */
  async getQueueStats(vehicleId: string): Promise<{
    total: number;
    pending: number;
    uploading: number;
    completed: number;
    failed: number;
  }> {
    await this.init();
    if (!this.db) return { total: 0, pending: 0, uploading: 0, completed: 0, failed: 0 };

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const index = store.index('vehicleId');
      const request = index.getAll(vehicleId);

      request.onsuccess = () => {
        const files = request.result as QueuedFile[];
        resolve({
          total: files.length,
          pending: files.filter(f => f.status === 'pending').length,
          uploading: files.filter(f => f.status === 'uploading').length,
          completed: files.filter(f => f.status === 'completed').length,
          failed: files.filter(f => f.status === 'failed').length
        });
      };
      request.onerror = () => reject(request.error);
    });
  }
}

export const uploadQueueService = new UploadQueueService();

