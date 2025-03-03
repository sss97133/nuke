
import React from 'react';
import { Upload } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { GalleryHeaderProps } from './types';

export const GalleryHeader: React.FC<GalleryHeaderProps> = ({ onOpenUploadModal }) => {
  return (
    <div className="flex justify-end mb-3">
      <Button 
        size="sm" 
        variant="outline"
        onClick={onOpenUploadModal}
      >
        <Upload className="h-4 w-4 mr-2" />
        Upload Images
      </Button>
    </div>
  );
};
