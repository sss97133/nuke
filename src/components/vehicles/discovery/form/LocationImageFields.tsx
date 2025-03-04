
import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface LocationImageFieldsProps {
  formData: {
    location: string;
    image: string;
  };
  handleChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

const LocationImageFields = ({ formData, handleChange }: LocationImageFieldsProps) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="space-y-2">
        <Label htmlFor="location">Location</Label>
        <Input 
          id="location" 
          name="location" 
          value={formData.location} 
          onChange={handleChange} 
          placeholder="e.g. Los Angeles, CA"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="image">Image URL</Label>
        <Input 
          id="image" 
          name="image" 
          value={formData.image} 
          onChange={handleChange} 
          placeholder="https://example.com/image.jpg"
        />
      </div>
    </div>
  );
};

export default LocationImageFields;
