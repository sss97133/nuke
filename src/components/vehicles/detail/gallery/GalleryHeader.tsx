
import React from 'react';
import { View, Upload } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { CardHeader, CardTitle } from "@/components/ui/card";
import { GalleryHeaderProps } from './types';

export const GalleryHeader: React.FC<GalleryHeaderProps> = ({ onOpenUploadModal }) => {
  return (
    <CardHeader className="flex flex-row items-center justify-between">
      <CardTitle>Vehicle Gallery</CardTitle>
      <div className="flex gap-2">
        <Button size="sm" variant="outline">
          <View className="h-4 w-4 mr-2" />
          View All
        </Button>
        <Button 
          size="sm" 
          variant="outline"
          onClick={onOpenUploadModal}
        >
          <Upload className="h-4 w-4 mr-2" />
          Upload
        </Button>
      </div>
    </CardHeader>
  );
};
