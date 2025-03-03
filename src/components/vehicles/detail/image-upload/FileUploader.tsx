
import React from 'react';
import { Image } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FileUploaderProps } from './types';

export const FileUploader: React.FC<FileUploaderProps> = ({ handleFileChange }) => {
  return (
    <div className="space-y-2">
      <Label htmlFor="car-images">Upload Images</Label>
      <div className="border-2 border-dashed rounded-lg p-4 text-center">
        <Input
          id="car-images"
          type="file"
          multiple
          accept="image/*"
          onChange={handleFileChange}
          className="hidden"
        />
        <Label htmlFor="car-images" className="cursor-pointer block">
          <Button type="button" variant="outline" className="w-full">
            <Image className="h-4 w-4 mr-2" />
            Select Photos
          </Button>
        </Label>
        <p className="text-sm text-muted-foreground mt-2">
          Supported formats: JPG, PNG, HEIC (Max 10MB each)
        </p>
      </div>
    </div>
  );
};
