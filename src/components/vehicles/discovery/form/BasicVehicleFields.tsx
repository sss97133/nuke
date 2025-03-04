
import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface BasicVehicleFieldsProps {
  formData: {
    make: string;
    model: string;
    year: number;
  };
  handleChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

const BasicVehicleFields = ({ formData, handleChange }: BasicVehicleFieldsProps) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="space-y-2">
        <Label htmlFor="make">Make *</Label>
        <Input 
          id="make" 
          name="make" 
          value={formData.make} 
          onChange={handleChange} 
          required 
          placeholder="e.g. Toyota"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="model">Model *</Label>
        <Input 
          id="model" 
          name="model" 
          value={formData.model} 
          onChange={handleChange} 
          required 
          placeholder="e.g. Supra"
        />
      </div>
    </div>
  );
};

export default BasicVehicleFields;
