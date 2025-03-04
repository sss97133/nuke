
import React from 'react';
import { Button } from '@/components/ui/button';

interface FormActionsProps {
  isSubmitting: boolean;
  onCancel: () => void;
  isFormValid: boolean;
}

const FormActions = ({ isSubmitting, onCancel, isFormValid }: FormActionsProps) => {
  return (
    <div className="flex justify-end gap-2">
      <Button 
        type="button" 
        variant="outline" 
        onClick={onCancel}
        disabled={isSubmitting}
      >
        Cancel
      </Button>
      <Button 
        type="submit" 
        disabled={isSubmitting || !isFormValid}
      >
        {isSubmitting ? 'Adding...' : 'Add Vehicle'}
      </Button>
    </div>
  );
};

export default FormActions;
