/**
 * Utility functions for file handling and validation
 */

/**
 * Format file size to a human-readable string
 * 
 * @param bytes - The file size in bytes
 * @returns A formatted string (e.g., "4.2 KB", "1.3 MB")
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
}

/**
 * Get a file extension from a filename
 * 
 * @param filename - The name of the file
 * @returns The file extension (lowercase, without the dot)
 */
export function getFileExtension(filename: string): string {
  return filename.split('.').pop()?.toLowerCase() || '';
}

/**
 * Check if a file is an image
 * 
 * @param file - The file to check
 * @returns True if the file is an image
 */
export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

/**
 * Check if a file is a PDF
 * 
 * @param file - The file to check
 * @returns True if the file is a PDF
 */
export function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf';
}

/**
 * Get a file icon name based on its type
 * 
 * @param file - The file to get an icon for
 * @returns A string representing the file type
 */
export function getFileTypeIcon(file: File): string {
  const ext = getFileExtension(file.name);
  
  if (isImageFile(file)) return 'image';
  if (isPdfFile(file)) return 'pdf';
  
  // Common document types
  if (['doc', 'docx'].includes(ext)) return 'word';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return 'excel';
  if (['ppt', 'pptx'].includes(ext)) return 'powerpoint';
  if (['txt', 'rtf'].includes(ext)) return 'text';
  
  // Default
  return 'file';
}

/**
 * Check if a file type is allowed
 * 
 * @param file - The file to check
 * @param allowedTypes - Array of allowed MIME types (e.g., ['image/*', 'application/pdf'])
 * @returns True if the file type is allowed
 */
export function isAllowedFileType(file: File, allowedTypes: string[]): boolean {
  return allowedTypes.some(type => {
    // Handle wildcard types like 'image/*'
    if (type.endsWith('/*')) {
      const category = type.split('/')[0];
      return file.type.startsWith(`${category}/`);
    }
    return file.type === type;
  });
}

/**
 * Validate a file against size and type constraints
 * 
 * @param file - The file to validate
 * @param maxSize - Maximum file size in bytes
 * @param allowedTypes - Array of allowed MIME types
 * @returns An object with validation result and error message
 */
export function validateFile(
  file: File, 
  maxSize: number, 
  allowedTypes: string[]
): { valid: boolean; reason?: string } {
  // Check file size
  if (file.size > maxSize) {
    return { 
      valid: false, 
      reason: `File size exceeds the limit of ${formatFileSize(maxSize)}` 
    };
  }
  
  // Check file type
  if (!isAllowedFileType(file, allowedTypes)) {
    return { 
      valid: false, 
      reason: 'File type not allowed' 
    };
  }
  
  return { valid: true };
}

/**
 * Create an object URL for a file and automatically handle cleanup
 * 
 * @param file - The file to create a URL for
 * @param callback - Function to call with the URL
 * @returns A cleanup function to revoke the URL
 */
export function createAndUseObjectURL(
  file: File, 
  callback: (url: string) => void
): () => void {
  const url = URL.createObjectURL(file);
  callback(url);
  
  // Return cleanup function
  return () => URL.revokeObjectURL(url);
}

/**
 * Read a file as a data URL
 * 
 * @param file - The file to read
 * @returns A promise that resolves with the data URL
 */
export function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read file'));
    
    reader.readAsDataURL(file);
  });
}

/**
 * Read a text file as text
 * 
 * @param file - The text file to read
 * @returns A promise that resolves with the file contents
 */
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read file'));
    
    reader.readAsText(file);
  });
}
