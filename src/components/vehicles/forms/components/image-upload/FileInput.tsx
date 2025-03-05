
import React, { useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Upload, ImagePlus } from 'lucide-react';

interface FileInputProps {
  name: string;
  multiple?: boolean;
  isUploading: boolean;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export const FileInput: React.FC<FileInputProps> = ({
  name,
  multiple = false,
  isUploading,
  onFileChange,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <Input
        type="file"
        id={`${name}-upload`}
        ref={fileInputRef}
        accept="image/*"
        multiple={multiple}
        className="hidden"
        onChange={onFileChange}
        disabled={isUploading}
      />
      <label 
        htmlFor={`${name}-upload`}
        className="cursor-pointer block"
      >
        <div className="flex flex-col items-center justify-center gap-2 py-4">
          <ImagePlus className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {isUploading 
              ? 'Uploading...' 
              : 'Drag & drop images here or click to browse'
            }
          </p>
          <Button 
            type="button" 
            variant="outline" 
            size="sm" 
            className="mt-2"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
          >
            <Upload className="h-4 w-4 mr-2" />
            {multiple ? 'Select Images' : 'Select Image'}
          </Button>
        </div>
      </label>
    </>
  );
};
