
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Form } from '@/components/ui/form';
import { VehicleFormValues } from './types';
import { useVehicleForm } from './hooks/useVehicleForm';
import { BasicInformationSection } from './components/BasicInformationSection';
import { AdditionalDetailsSection } from './components/AdditionalDetailsSection';
import { MediaTagsSection } from './components/MediaTagsSection';
import { NotesSection } from './components/NotesSection';
import { ClassificationSection } from './components/ClassificationSection';
import { OwnershipSection } from './components/OwnershipSection';
import { DiscoveryDetailsSection } from './components/DiscoveryDetailsSection';

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
  const { form, handleSubmit } = useVehicleForm(onSubmit);
  const ownershipStatus = form.watch('ownership_status');
  
  return (
    <Form {...form}>
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Ownership Status Selection */}
        <OwnershipSection form={form} />
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Basic Information */}
          <BasicInformationSection form={form} />
          
          {/* Additional Details */}
          <AdditionalDetailsSection form={form} />
        </div>
        
        {/* Classification Section */}
        <ClassificationSection form={form} />
        
        {/* Show Discovery Details if vehicle is discovered, not owned */}
        {ownershipStatus === 'discovered' && (
          <DiscoveryDetailsSection form={form} />
        )}
        
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
