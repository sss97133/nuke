
import React from 'react';
import { Button } from '@/components/ui/button';
import { Form } from '@/components/ui/form';
import { VehicleFormValues } from './types';
import { useVehicleForm } from './hooks/useVehicleForm';
import { BasicInformationSection } from './components/BasicInformationSection';
import { AdditionalDetailsSection } from './components/AdditionalDetailsSection';
import { MediaTagsSection } from './components/MediaTagsSection';
import { NotesSection } from './components/NotesSection';

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
  const form = useVehicleForm(initialValues);

  const handleSubmit = async (values: VehicleFormValues) => {
    await onSubmit(values);
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Basic Information */}
          <BasicInformationSection form={form} />
          
          {/* Additional Details */}
          <AdditionalDetailsSection form={form} />
        </div>
        
        {/* Media and Tags */}
        <MediaTagsSection form={form} />
        
        {/* Notes */}
        <NotesSection form={form} />
        
        <div className="flex justify-end">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Saving...' : 'Add Vehicle'}
          </Button>
        </div>
      </form>
    </Form>
  );
};

export default VehicleForm;
