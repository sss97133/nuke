
import React from 'react';
import { Button } from '@/components/ui/button';
import { DialogFooter } from '@/components/ui/dialog';

interface FormActionsProps {
  onCancel: () => void;
  onSubmit: () => void;
  isEditing: boolean;
}

export const FormActions: React.FC<FormActionsProps> = ({
  onCancel,
  onSubmit,
  isEditing
}) => {
  return (
    <DialogFooter>
      <Button variant="outline" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" onClick={onSubmit}>
        {isEditing ? 'Update' : 'Schedule'}
      </Button>
    </DialogFooter>
  );
};
