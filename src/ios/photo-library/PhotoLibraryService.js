/**
 * PhotoLibraryService.js
 * 
 * A JavaScript interface for the iOS PhotoLibraryService
 * This will communicate with the native Swift implementation when the app is packaged for iOS.
 * 
 * This file acts as a bridge between our React components and the native iOS functionality.
 */

class PhotoLibraryBridge {
  constructor() {
    this.isNative = false;
    this.mockAssets = [];
    
    // Check if we're running in a native iOS environment with the bridge available
    if (typeof window !== 'undefined' && window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.photoLibrary) {
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
    
    // Keep track of callbacks for async operations
    this.callbacks = {};
    this.progressHandlers = {};
  }
  
  // Private method to generate a unique callback ID
  _generateCallbackId() {
    return `cb_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  // Handle callbacks from native code
  _handleNativeCallback(callbackId, result, error) {
    if (this.callbacks[callbackId]) {
      if (error) {
        this.callbacks[callbackId].reject(new Error(error));
      } else {
        this.callbacks[callbackId].resolve(result);
      }
      
      // Clean up
      delete this.callbacks[callbackId];
    }
  }
  
  // Handle upload progress updates from native code
  _handleUploadProgress(callbackId, progress) {
    if (this.progressHandlers[callbackId]) {
      this.progressHandlers[callbackId](progress);
    }
  }
  
  // Handle upload completion from native code
  _handleUploadComplete(callbackId, success, error) {
    console.log(`Upload complete for ${callbackId}: ${success ? 'Success' : 'Failed'}`, error);
  }
  
  /**
   * Requests full access to the user's photo library
   * Returns a promise that resolves to true if access was granted
   */
  requestFullAccess() {
    return new Promise((resolve, reject) => {
      if (this.isNative) {
        const callbackId = this._generateCallbackId();
        this.callbacks[callbackId] = { resolve, reject };
        
        window.webkit.messageHandlers.photoLibrary.postMessage({
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
  getAuthorizationStatus() {
    return new Promise((resolve, reject) => {
      if (this.isNative) {
        const callbackId = this._generateCallbackId();
        this.callbacks[callbackId] = { resolve, reject };
        
        window.webkit.messageHandlers.photoLibrary.postMessage({
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
  fetchAllPhotos(config = {}) {
    return new Promise((resolve, reject) => {
      if (this.isNative) {
        const callbackId = this._generateCallbackId();
        this.callbacks[callbackId] = { resolve, reject };
        
        window.webkit.messageHandlers.photoLibrary.postMessage({
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
  fetchPhotosBatched(callback, config = { batchSize: 20 }) {
    return new Promise((resolve, reject) => {
      if (this.isNative) {
        // In native mode, we'd set up a system where the native code can call back multiple times
        // This is a simplification
        this.fetchAllPhotos(config)
          .then(assets => {
            // Manually batch the results
            const batches = [];
            for (let i = 0; i < assets.length; i += config.batchSize) {
              batches.push(assets.slice(i, i + config.batchSize));
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
        const batchSize = config.batchSize || 5;
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
          
          const batchData = {
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
  getImageData(assetId, quality = 'high') {
    return new Promise((resolve, reject) => {
      if (this.isNative) {
        const callbackId = this._generateCallbackId();
        this.callbacks[callbackId] = { resolve, reject };
        
        window.webkit.messageHandlers.photoLibrary.postMessage({
          method: 'getImageData',
          callbackId,
          assetId,
          quality
        });
      } else {
        // Mock implementation for web
        console.log(`PhotoLibraryService: getImageData() called for asset ${assetId} with quality ${quality}`);
        
        // Return a placeholder blob
        setTimeout(() => {
          // Create a small canvas and get its data
          const canvas = document.createElement('canvas');
          canvas.width = 100;
          canvas.height = 100;
          const ctx = canvas.getContext('2d');
          
          // Draw something based on assetId to make it unique
          const idNum = parseInt(assetId.replace(/\D/g, ''), 10) || 0;
          ctx.fillStyle = `hsl(${idNum % 360}, 80%, 60%)`;
          ctx.fillRect(0, 0, 100, 100);
          ctx.fillStyle = 'white';
          ctx.font = '14px sans-serif';
          ctx.fillText(`Asset ${idNum}`, 20, 50);
          
          canvas.toBlob(blob => {
            resolve(blob);
          });
        }, 300);
      }
    });
  }
  
  /**
   * Upload all photos to the server for a specific vehicle
   */
  uploadAllPhotos(vehicleId, config = {}, progressCallback = null) {
    return new Promise((resolve, reject) => {
      if (this.isNative) {
        const callbackId = this._generateCallbackId();
        this.callbacks[callbackId] = { resolve, reject };
        
        // Store progress callback if provided
        if (progressCallback) {
          this.progressHandlers[callbackId] = progressCallback;
        }
        
        window.webkit.messageHandlers.photoLibrary.postMessage({
          method: 'uploadAllPhotos',
          callbackId,
          vehicleId,
          config
        });
      } else {
        // Mock implementation for web
        console.log(`PhotoLibraryService: uploadAllPhotos() called for vehicle ${vehicleId}`);
        
        // Simulate an upload process with progress updates
        let progress = 0;
        const imageIds = [];
        
        // Generate some random image IDs that would be returned from server
        for (let i = 0; i < 10; i++) {
          imageIds.push(`uploaded_image_${Date.now()}_${i}`);
        }
        
        const interval = setInterval(() => {
          progress += 0.1;
          
          if (progressCallback) {
            progressCallback(progress);
          }
          
          if (progress >= 1) {
            clearInterval(interval);
            resolve(imageIds);
          }
        }, 500);
      }
    });
  }
  
  /**
   * Cancel ongoing uploads
   */
  cancelUploads() {
    return new Promise((resolve, reject) => {
      if (this.isNative) {
        const callbackId = this._generateCallbackId();
        this.callbacks[callbackId] = { resolve, reject };
        
        window.webkit.messageHandlers.photoLibrary.postMessage({
          method: 'cancelUploads',
          callbackId
        });
      } else {
        // Mock implementation for web
        console.log('PhotoLibraryService: cancelUploads() called');
        setTimeout(resolve, 100);
      }
    });
  }
}

// Export a singleton instance
export const photoLibraryService = new PhotoLibraryBridge();

// Export types for documentation and development
export const PhotoLibraryAuthStatus = {
  AUTHORIZED: 'authorized',
  LIMITED: 'limited',
  DENIED: 'denied',
  RESTRICTED: 'restricted',
  NOT_DETERMINED: 'notDetermined'
};
