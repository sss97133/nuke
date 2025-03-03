
import React, { useState } from 'react';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle 
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Image, Upload, X } from 'lucide-react';
import { Textarea } from "@/components/ui/textarea";

interface ImageUploadModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpload: (files: FileList | null, type: string, description: string) => void;
  vehicleInfo?: {
    make: string;
    model: string;
    year: number | string;
  };
}

export const ImageUploadModal: React.FC<ImageUploadModalProps> = ({
  open,
  onOpenChange,
  onUpload,
  vehicleInfo
}) => {
  const [selectedFiles, setSelectedFiles] = useState<FileList | null>(null);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [imageType, setImageType] = useState<string>('exterior');
  const [description, setDescription] = useState<string>('');

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    setSelectedFiles(files);
    
    // Generate previews
    const urls: string[] = [];
    Array.from(files).forEach(file => {
      urls.push(URL.createObjectURL(file));
    });
    setPreviewUrls(urls);
  };

  const handleSubmit = () => {
    onUpload(selectedFiles, imageType, description);
    // Clean up
    resetForm();
  };

  const resetForm = () => {
    // Revoke object URLs to avoid memory leaks
    previewUrls.forEach(url => URL.revokeObjectURL(url));
    setPreviewUrls([]);
    setSelectedFiles(null);
    setImageType('exterior');
    setDescription('');
  };

  const removePreview = (index: number) => {
    URL.revokeObjectURL(previewUrls[index]);
    setPreviewUrls(prev => prev.filter((_, i) => i !== index));
    
    // Remove from FileList - we can't modify FileList directly, so we need to create a new one
    if (selectedFiles) {
      const dataTransfer = new DataTransfer();
      Array.from(selectedFiles)
        .filter((_, i) => i !== index)
        .forEach(file => dataTransfer.items.add(file));
      setSelectedFiles(dataTransfer.files);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(newOpen) => {
      if (!newOpen) resetForm();
      onOpenChange(newOpen);
    }}>
      <DialogContent className="sm:max-w-md md:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload Vehicle Images</DialogTitle>
          <DialogDescription>
            {vehicleInfo 
              ? `Add images for ${vehicleInfo.year} ${vehicleInfo.make} ${vehicleInfo.model}`
              : 'Share your vehicle pictures with the community'}
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="image-type">Image Type</Label>
            <Select 
              value={imageType} 
              onValueChange={setImageType}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select image type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="exterior">Exterior</SelectItem>
                <SelectItem value="interior">Interior</SelectItem>
                <SelectItem value="engine">Engine</SelectItem>
                <SelectItem value="damage">Damage</SelectItem>
                <SelectItem value="modification">Modification</SelectItem>
                <SelectItem value="detail">Detail</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="image-description">Description (Optional)</Label>
            <Textarea
              id="image-description"
              placeholder="Add any details about the images"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="resize-none"
              rows={3}
            />
          </div>
          
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
          
          {previewUrls.length > 0 && (
            <div className="space-y-2">
              <Label>Selected Images ({previewUrls.length})</Label>
              <div className="grid grid-cols-3 gap-2">
                {previewUrls.map((url, index) => (
                  <div key={index} className="relative aspect-square rounded-md overflow-hidden group">
                    <img 
                      src={url} 
                      alt={`Preview ${index}`} 
                      className="object-cover w-full h-full"
                    />
                    <button
                      type="button"
                      onClick={() => removePreview(index)}
                      className="absolute top-1 right-1 bg-black/50 rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="h-4 w-4 text-white" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          <div className="bg-muted p-3 rounded-md">
            <p className="text-sm">
              <strong>Note:</strong> Uploaded images will be reviewed for quality and relevance 
              before being fully published. Images from verified users or PTZ garages 
              are prioritized in the verification process.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button 
            variant="outline" 
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button 
            onClick={handleSubmit}
            disabled={!selectedFiles || selectedFiles.length === 0}
          >
            <Upload className="h-4 w-4 mr-2" />
            Submit Images
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
