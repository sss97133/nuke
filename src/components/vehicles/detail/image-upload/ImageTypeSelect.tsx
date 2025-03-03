
import React from 'react';
import { Label } from "@/components/ui/label";
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ImageTypeSelectProps } from './types';

export const ImageTypeSelect: React.FC<ImageTypeSelectProps> = ({ imageType, setImageType }) => {
  return (
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
  );
};
