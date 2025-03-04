
import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface SpecificationFieldsProps {
  formData: {
    year: number;
    price: number;
    mileage: number;
  };
  handleChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

const SpecificationFields = ({ formData, handleChange }: SpecificationFieldsProps) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="space-y-2">
        <Label htmlFor="year">Year *</Label>
        <Input 
          id="year" 
          name="year" 
          type="number" 
          value={formData.year} 
          onChange={handleChange} 
          required 
          min={1900} 
          max={new Date().getFullYear() + 1}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="price">Price ($)</Label>
        <Input 
          id="price" 
          name="price" 
          type="number" 
          value={formData.price} 
          onChange={handleChange} 
          min={0}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="mileage">Mileage</Label>
        <Input 
          id="mileage" 
          name="mileage" 
          type="number" 
          value={formData.mileage} 
          onChange={handleChange} 
          min={0}
        />
      </div>
    </div>
  );
};

export default SpecificationFields;
