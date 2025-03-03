
import React from 'react';
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DescriptionInputProps } from './types';

export const DescriptionInput: React.FC<DescriptionInputProps> = ({ description, setDescription }) => {
  return (
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
  );
};
