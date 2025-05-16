import { useState } from 'react';
import { useToast } from './__mocks__/use-toast';
import { PartItem } from '../../types';
import { FormState, FormStateValue } from '../types';

interface UsePartsManagementProps {
  updateFormState: (field: keyof FormState, value: FormStateValue) => void;
}

export const usePartsManagement = (
  formState: FormState,
  updateFormState: (field: keyof FormState, value: FormStateValue) => void
) => {
  const { toast } = useToast();
  
  const [newPart, setNewPart] = useState<PartItem>({
    name: '',
    quantity: 1,
    cost: 0
  });

  const updateNewPart = (partData: Partial<PartItem>) => {
    setNewPart(prev => ({
      ...prev,
      ...partData
    }));
  };

  const addPart = () => {
    if (!newPart.name.trim()) {
      toast({
        title: 'Missing information',
        description: 'Please enter a part name',
        variant: 'destructive',
      });
      return;
    }

    const currentParts = Array.isArray(formState.parts) ? formState.parts : [];
    updateFormState('parts', [...currentParts, {...newPart}]);

    // Reset the new part form
    setNewPart({
      name: '',
      quantity: 1,
      cost: 0
    });
  };

  const removePart = (index: number) => {
    if (!formState.parts || !Array.isArray(formState.parts)) {
      return;
    }
    
    updateFormState(
      'parts', 
      formState.parts.filter((_, i) => i !== index)
    );
  };

  return {
    newPart,
    updateNewPart,
    addPart,
    removePart
  };
};
