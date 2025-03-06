/**
 * Utility functions for file uploads
 */

/**
 * Validate an image file for upload
 * @param file File to validate
 * @param options Validation options
 * @returns Validation result
 */
export const validateImageFile = (
  file: File,
  options: {
    maxSizeInMB?: number;
    allowedTypes?: string[];
  } = {}
): { valid: boolean; error?: string } => {
  // Default options
  const {
    maxSizeInMB = 2,
    allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
  } = options;

  // Check if file exists
  if (!file) {
    return { valid: false, error: 'No file selected' };
  }

  // Check file type
  if (!file.type.startsWith('image/')) {
    return { valid: false, error: 'Selected file is not an image' };
  }

  // Check specific allowed types if specified
  if (allowedTypes.length > 0 && !allowedTypes.includes(file.type)) {
    return {
      valid: false,
      error: `Unsupported image type. Please upload one of: ${allowedTypes.join(', ')}`
    };
  }

  // Check file size
  const maxSizeInBytes = maxSizeInMB * 1024 * 1024;
  if (file.size > maxSizeInBytes) {
    return {
      valid: false,
      error: `Image size exceeds ${maxSizeInMB}MB limit`
    };
  }

  return { valid: true };
};

/**
 * Generate a unique file name for upload
 * @param file Original file
 * @param prefix Optional prefix for the file name
 * @returns A unique file name with original extension
 */
export const generateUniqueFileName = (file: File, prefix = ''): string => {
  const fileExt = file.name.split('.').pop();
  const timestamp = Date.now();
  const randomString = Math.random().toString(36).substring(2, 10);
  
  return `${prefix}${timestamp}-${randomString}.${fileExt}`;
};

/**
 * Format file size to human readable format
 * @param bytes File size in bytes
 * @returns Formatted string (e.g., "1.5 MB")
 */
export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};
