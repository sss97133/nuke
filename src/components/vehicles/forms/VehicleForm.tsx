
import React from 'react';
import { Button } from '@/components/ui/button';

export interface VehicleFormValues {
  make: string;
  model: string;
  year: number;
  color?: string;
  vin?: string;
  mileage?: number;
  trim?: string;
  image?: string;
  tags?: string;
  notes?: string;
}

interface VehicleFormProps {
  onSubmit: (data: VehicleFormValues) => Promise<void>;
  isSubmitting: boolean;
  initialValues?: Partial<VehicleFormValues>;
}

const VehicleForm: React.FC<VehicleFormProps> = ({ 
  onSubmit, 
  isSubmitting,
  initialValues = {}
}) => {
  // Simple default implementation for now
  return (
    <div className="grid gap-6">
      <p className="text-muted-foreground">
        This is a placeholder for the VehicleForm component. In a real implementation, this would contain
        form fields for vehicle details.
      </p>
      
      <div className="flex justify-end">
        <Button disabled={isSubmitting}>
          {isSubmitting ? 'Saving...' : 'Add Vehicle'}
        </Button>
      </div>
    </div>
  );
};

export default VehicleForm;
