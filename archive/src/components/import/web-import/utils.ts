
export interface FileValidationResult {
  isValid: boolean;
  errorTitle?: string;
  errorMessage?: string;
}

export const validateWebImportFile = (file: File): FileValidationResult => {
  const fileExtension = file.name.split('.').pop()?.toLowerCase();
  
  // Validate file type
  const validFileTypes = ['html', 'xml', 'json', 'csv'];
  if (!fileExtension || !validFileTypes.includes(fileExtension)) {
    return {
      isValid: false,
      errorTitle: "Invalid file type",
      errorMessage: `Please select an HTML, XML, JSON, or CSV file. You selected: ${fileExtension?.toUpperCase() || 'Unknown'}`
    };
  }
  
  // Validate file size (max 10MB)
  const maxSize = 10 * 1024 * 1024; // 10MB
  if (file.size > maxSize) {
    return {
      isValid: false,
      errorTitle: "File too large",
      errorMessage: `Maximum file size is 10MB. Your file is ${(file.size / (1024 * 1024)).toFixed(2)}MB`
    };
  }
  
  return { isValid: true };
};
