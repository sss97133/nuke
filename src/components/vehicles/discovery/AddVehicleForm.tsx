
import React from 'react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Vehicle } from './types';
import BasicVehicleFields from './form/BasicVehicleFields';
import SpecificationFields from './form/SpecificationFields';
import LocationImageFields from './form/LocationImageFields';
import FormActions from './form/FormActions';
import { useVehicleForm } from './form/useVehicleForm';

interface AddVehicleFormProps {
  onAddVehicle: (vehicle: Omit<Vehicle, 'id' | 'added' | 'relevance_score'>) => Promise<any>;
  onCancel: () => void;
}

const AddVehicleForm = ({ onAddVehicle, onCancel }: AddVehicleFormProps) => {
  const { 
    formData, 
    isSubmitting, 
    isFormValid,
    handleChange, 
    handleSubmit 
  } = useVehicleForm({ onAddVehicle, onCancel });

  return (
    <Card className="w-full max-w-3xl mx-auto">
      <CardHeader>
        <CardTitle>Add New Vehicle</CardTitle>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-6">
          <BasicVehicleFields 
            formData={formData} 
            handleChange={handleChange} 
          />
          
          <SpecificationFields 
            formData={formData} 
            handleChange={handleChange} 
          />
          
          <LocationImageFields 
            formData={formData} 
            handleChange={handleChange} 
          />
        </CardContent>
        
        <CardFooter>
          <FormActions 
            isSubmitting={isSubmitting} 
            onCancel={onCancel} 
            isFormValid={isFormValid}
          />
        </CardFooter>
      </form>
    </Card>
  );
};

export default AddVehicleForm;
