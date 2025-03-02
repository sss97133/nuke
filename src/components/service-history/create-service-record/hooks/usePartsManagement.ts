
import { useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { PartItem } from '../../types';
import { FormState } from '../types';

export const usePartsManagement = (
  formState: FormState,
  updateFormState: (field: keyof FormState, value: any) => void
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

    updateFormState('parts', [...formState.parts, {...newPart}]);

    // Reset the new part form
    setNewPart({
      name: '',
      quantity: 1,
      cost: 0
    });
  };

  const removePart = (index: number) => {
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
