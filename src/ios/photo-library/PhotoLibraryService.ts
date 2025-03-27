/**
 * PhotoLibraryService.ts
 * 
 * A TypeScript interface for the iOS PhotoLibraryService
 * This will communicate with the native Swift implementation when the app is packaged for iOS.
 * 
 * This file acts as a bridge between our React components and the native iOS functionality.
 */

interface PhotoAsset {
  id: string;
  filename: string;
  creationDate: string;
  width: number;
  height: number;
  mediaType: string;
  location?: {
    latitude: number;
    longitude: number;
  };
}

interface BatchData {
  assets: PhotoAsset[];
  batchId: string;
  totalAssets: number;
  batchIndex: number;
}

interface Callback<T> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

interface WebKitMessageHandlers {
  photoLibrary: {
    postMessage: (message: unknown) => void;
  };
}

interface Window {
  webkit?: {
    messageHandlers: {
      photoLibrary: {
        postMessage: (message: unknown) => void;
      };
    };
  };
  photoLibraryCallback?: (callbackId: string, result: unknown, error?: string) => void;
  photoUploadProgress?: (callbackId: string, progress: number) => void;
  photoUploadComplete?: (callbackId: string, success: boolean, error?: string) => void;
}

declare global {
  interface Window {
    webkit?: {
      messageHandlers: {
        photoLibrary: {
          postMessage: (message: unknown) => void;
        };
      };
    };
    photoLibraryCallback?: (callbackId: string, result: unknown, error?: string) => void;
    photoUploadProgress?: (callbackId: string, progress: number) => void;
    photoUploadComplete?: (callbackId: string, success: boolean, error?: string) => void;
  }
}

class PhotoLibraryBridge {
  private isNative: boolean;
  private mockAssets: PhotoAsset[];
  private callbacks: Map<string, Callback<unknown>> = new Map();
  private callbackIdCounter = 0;
  private progressHandlers: Record<string, (progress: number) => void>;

  constructor() {
    this.isNative = false;
    this.mockAssets = [];
    this.progressHandlers = {};
    
    // Check if we're running in a native iOS environment with the bridge available
    if (typeof window !== 'undefined' && window.webkit?.messageHandlers?.photoLibrary) {
      this.isNative = true;
      console.log('iOS Photo Library bridge is available');
    } else {
      console.log('Running in web environment, using mock PhotoLibraryService');
      
      // Generate some mock assets for testing
      for (let i = 1; i <= 20; i++) {
        this.mockAssets.push({
          id: `mock-asset-${i}`,
          filename: `image_${i}.jpg`,
          creationDate: new Date(Date.now() - i * 86400000).toISOString(),
          width: 1200,
          height: 800,
          mediaType: 'image',
          location: i % 3 === 0 ? {
            latitude: 37.7749 + (Math.random() - 0.5) * 0.1,
            longitude: -122.4194 + (Math.random() - 0.5) * 0.1
          } : undefined
        });
      }
    }
    
    // Set up message handlers for native callbacks
    if (typeof window !== 'undefined') {
      window.photoLibraryCallback = this._handleNativeCallback.bind(this);
      window.photoUploadProgress = this._handleUploadProgress.bind(this);
      window.photoUploadComplete = this._handleUploadComplete.bind(this);
    }
  }
  
  private generateCallbackId(): string {
    return `callback_${this.callbackIdCounter++}`;
  }

  private addCallback<T>(callbackId: string, callback: Callback<T>): void {
    this.callbacks.set(callbackId, callback as Callback<unknown>);
  }

  private removeCallback(callbackId: string): void {
    this.callbacks.delete(callbackId);
  }

  private getCallback(callbackId: string): Callback<unknown> | undefined {
    return this.callbacks.get(callbackId);
  }
  
  // Handle callbacks from native code
  private _handleNativeCallback(callbackId: string, result: unknown, error?: string): void {
    if (this.getCallback(callbackId)) {
      if (error) {
        this.getCallback(callbackId)?.reject(new Error(error));
      } else {
        this.getCallback(callbackId)?.resolve(result);
      }
      
      // Clean up
      this.removeCallback(callbackId);
    }
  }
  
  // Handle upload progress updates from native code
  private _handleUploadProgress(callbackId: string, progress: number): void {
    if (this.progressHandlers[callbackId]) {
      this.progressHandlers[callbackId](progress);
    }
  }
  
  // Handle upload completion from native code
  private _handleUploadComplete(callbackId: string, success: boolean, error?: string): void {
    console.log(`Upload complete for ${callbackId}: ${success ? 'Success' : 'Failed'}`, error);
  }
  
  /**
   * Requests full access to the user's photo library
   * Returns a promise that resolves to true if access was granted
   */
  requestFullAccess(): Promise<boolean> {
    return new Promise((resolve, reject) => {
      if (this.isNative) {
        const callbackId = this.generateCallbackId();
        this.addCallback(callbackId, { resolve: (value: unknown) => resolve(value as boolean), reject });
        
        window.webkit?.messageHandlers.photoLibrary.postMessage({
          method: 'requestFullAccess',
          callbackId
        });
      } else {
        // Mock implementation for web
        console.log('PhotoLibraryService: requestFullAccess() called');
        setTimeout(() => {
          // Simulate permission dialog and randomly grant access
          const granted = Math.random() > 0.3;
          console.log(`PhotoLibraryService: Access ${granted ? 'granted' : 'denied'}`);
          resolve(granted);
        }, 500);
      }
    });
  }
  
  /**
   * Gets the current authorization status
   */
  getAuthorizationStatus(): Promise<string> {
    return new Promise((resolve, reject) => {
      if (this.isNative) {
        const callbackId = this.generateCallbackId();
        this.addCallback(callbackId, { resolve: (value: unknown) => resolve(value as string), reject });
        
        window.webkit?.messageHandlers.photoLibrary.postMessage({
          method: 'getAuthorizationStatus',
          callbackId
        });
      } else {
        // Mock implementation for web
        setTimeout(() => {
          // Randomly return a status for testing
          const statuses = ['authorized', 'limited', 'denied', 'restricted', 'notDetermined'];
          const status = statuses[Math.floor(Math.random() * statuses.length)];
          resolve(status);
        }, 100);
      }
    });
  }
  
  /**
   * Fetches all photos from the library
   */
  fetchAllPhotos(config: Record<string, unknown> = {}): Promise<PhotoAsset[]> {
    return new Promise((resolve, reject) => {
      if (this.isNative) {
        const callbackId = this.generateCallbackId();
        this.addCallback(callbackId, { resolve: (value: unknown) => resolve(value as PhotoAsset[]), reject });
        
        window.webkit?.messageHandlers.photoLibrary.postMessage({
          method: 'fetchAllPhotos',
          callbackId,
          config
        });
      } else {
        // Mock implementation for web
        console.log('PhotoLibraryService: fetchAllPhotos() called with config:', config);
        setTimeout(() => {
          resolve([...this.mockAssets]);
        }, 800);
      }
    });
  }
  
  /**
   * Fetch photos in batches with a callback for each batch
   */
  fetchPhotosBatched(
    callback: (batch: BatchData) => Promise<void>,
    config: { batchSize?: number } = { batchSize: 20 }
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.isNative) {
        // In native mode, we'd set up a system where the native code can call back multiple times
        // This is a simplification
        this.fetchAllPhotos(config)
          .then(assets => {
            // Manually batch the results
            const batches: PhotoAsset[][] = [];
            const batchSize = config.batchSize ?? 20;
            for (let i = 0; i < assets.length; i += batchSize) {
              batches.push(assets.slice(i, i + batchSize));
            }
            
            // Process batches sequentially
            return batches.reduce((promise, batch, index) => {
              return promise.then(() => {
                return callback({
                  assets: batch,
                  batchId: `batch_${index}`,
                  totalAssets: assets.length,
                  batchIndex: index
                });
              });
            }, Promise.resolve());
          })
          .then(resolve)
          .catch(reject);
      } else {
        // Mock implementation for web
        console.log('PhotoLibraryService: fetchPhotosBatched() called');
        
        // Create batches of the mock assets
        const batchSize = config.batchSize ?? 5;
        const totalAssets = this.mockAssets.length;
        const batchCount = Math.ceil(totalAssets / batchSize);
        
        // Process batches with setTimeout to simulate async operations
        let currentBatch = 0;
        
        const processBatch = () => {
          if (currentBatch >= batchCount) {
            resolve();
            return;
          }
          
          const start = currentBatch * batchSize;
          const end = Math.min(start + batchSize, totalAssets);
          const batchAssets = this.mockAssets.slice(start, end);
          
          const batchData: BatchData = {
            assets: batchAssets,
            batchId: `mock_batch_${currentBatch}`,
            totalAssets,
            batchIndex: currentBatch
          };
          
          // Call the callback with this batch
          Promise.resolve(callback(batchData))
            .then(() => {
              currentBatch++;
              setTimeout(processBatch, 300); // Delay to simulate network
            })
            .catch(reject);
        };
        
        // Start processing
        setTimeout(processBatch, 300);
      }
    });
  }
  
  /**
   * Get image data for a specific asset
   */
  getImageData(assetId: string, quality: 'low' | 'medium' | 'high' = 'high'): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (this.isNative) {
        const callbackId = this.generateCallbackId();
        this.addCallback(callbackId, { resolve: (value: unknown) => resolve(value as Blob), reject });
        
        window.webkit?.messageHandlers.photoLibrary.postMessage({
          method: 'getImageData',
          callbackId,
          assetId,
          quality
        });
      } else {
        // Mock implementation for web
        console.log(`PhotoLibraryService: getImageData() called for asset ${assetId} with quality ${quality}`);
        setTimeout(() => {
          // Create a mock blob
          const mockBlob = new Blob(['mock image data'], { type: 'image/jpeg' });
          resolve(mockBlob);
        }, 300);
      }
    });
  }
}

export default new PhotoLibraryBridge();