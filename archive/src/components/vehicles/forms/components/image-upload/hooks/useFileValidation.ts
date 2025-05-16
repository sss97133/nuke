
import { useToast } from '@/hooks/use-toast';

interface ValidationOptions {
  maxSize?: number; // in bytes
  allowedTypes?: string[];
  maxFiles?: number;
}

export const useFileValidation = () => {
  const { toast } = useToast();
  
  const validateFiles = (files: FileList, options: ValidationOptions = {}) => {
    const {
      maxSize = 5 * 1024 * 1024, // 5MB default
      allowedTypes = ['image/'],
      maxFiles = 10
    } = options;
    
    // Check number of files
    if (maxFiles && files.length > maxFiles) {
      toast({
        title: 'Too many files',
        description: `You can upload a maximum of ${maxFiles} file(s) at once`,
        variant: 'destructive',
      });
      return false;
    }
    
    // Validate each file
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      
      // Validate file size
      if (file.size > maxSize) {
        toast({
          title: 'File too large',
          description: `${file.name} exceeds the ${maxSize / (1024 * 1024)}MB limit`,
          variant: 'destructive',
        });
        return false;
      }
      
      // Validate file type
      const validType = allowedTypes.some(type => 
        type.endsWith('/') ? file.type.startsWith(type) : file.type === type
      );
      
      if (!validType) {
        toast({
          title: 'Invalid file type',
          description: `${file.name} is not an accepted file type`,
          variant: 'destructive',
        });
        return false;
      }
    }
    
    return true;
  };
  
  return { validateFiles };
};
