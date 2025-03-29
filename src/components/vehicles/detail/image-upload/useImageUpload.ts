import { useState } from 'react';
import { useToast } from '@/hooks/use-toast';

export const useImageUpload = (onUpload: (files: FileList | null, type: string, description: string) => void) => {
  const [imageType, setImageType] = useState<string>('exterior');
  const [description, setDescription] = useState<string>('');
  const { toast } = useToast();

  const handleSubmit = (urls: string[], type: string, desc: string) => {
    if (urls.length === 0) {
      toast({
        title: 'No images selected',
        description: 'Please select at least one image to upload.',
        variant: 'destructive',
      });
      return;
    }

    // Convert URLs to FileList-like object
    const files = urls.map(url => ({
      name: url.split('/').pop() || 'image.jpg',
      type: 'image/jpeg',
      size: 0, // We don't have the actual file size
      lastModified: Date.now(),
    }));

    onUpload(files as unknown as FileList, type, desc);
  };

  const resetForm = () => {
    setImageType('exterior');
    setDescription('');
  };

  return {
    imageType,
    setImageType,
    description,
    setDescription,
    handleSubmit,
    resetForm,
  };
};
