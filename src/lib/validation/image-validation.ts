export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export interface ImageValidationOptions {
  maxSize?: number;
  allowedTypes?: string[];
  maxWidth?: number;
  maxHeight?: number;
}

export const DEFAULT_IMAGE_OPTIONS: ImageValidationOptions = {
  maxSize: 10 * 1024 * 1024, // 10MB
  allowedTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic'],
  maxWidth: 4096,
  maxHeight: 4096
};

export const validateImageFile = async (
  file: File, 
  options: ImageValidationOptions = DEFAULT_IMAGE_OPTIONS
): Promise<ValidationResult> => {
  // Check file type
  if (!options.allowedTypes?.includes(file.type)) {
    return { 
      valid: false, 
      error: `Invalid file type. Allowed types: ${options.allowedTypes.join(', ')}` 
    };
  }

  // Check file size
  if (file.size > (options.maxSize || DEFAULT_IMAGE_OPTIONS.maxSize!)) {
    return { 
      valid: false, 
      error: `File too large. Maximum size: ${(options.maxSize || DEFAULT_IMAGE_OPTIONS.maxSize!) / (1024 * 1024)}MB` 
    };
  }

  // Check image dimensions
  try {
    const dimensions = await getImageDimensions(file);
    if (dimensions.width > (options.maxWidth || DEFAULT_IMAGE_OPTIONS.maxWidth!)) {
      return { 
        valid: false, 
        error: `Image too wide. Maximum width: ${options.maxWidth || DEFAULT_IMAGE_OPTIONS.maxWidth}px` 
      };
    }
    if (dimensions.height > (options.maxHeight || DEFAULT_IMAGE_OPTIONS.maxHeight!)) {
      return { 
        valid: false, 
        error: `Image too tall. Maximum height: ${options.maxHeight || DEFAULT_IMAGE_OPTIONS.maxHeight}px` 
      };
    }
  } catch (error) {
    return { 
      valid: false, 
      error: 'Failed to validate image dimensions' 
    };
  }

  return { valid: true };
};

interface ImageDimensions {
  width: number;
  height: number;
}

const getImageDimensions = (file: File): Promise<ImageDimensions> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      resolve({
        width: img.width,
        height: img.height
      });
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = URL.createObjectURL(file);
  });
}; 