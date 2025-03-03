
import React from 'react';
import { Button } from "@/components/ui/button";
import { DialogClose, DialogFooter } from "@/components/ui/dialog";

interface FormActionsProps {
  isSubmitting: boolean;
}

export const FormActions: React.FC<FormActionsProps> = ({ isSubmitting }) => {
  console.log("FormActions rendering, isSubmitting:", isSubmitting);
  
  return (
    <DialogFooter>
      <DialogClose asChild>
        <Button 
          type="button" 
          variant="outline" 
          disabled={isSubmitting}
          onClick={() => console.log("Cancel button clicked")}
        >
          Cancel
        </Button>
      </DialogClose>
      <Button 
        type="submit" 
        disabled={isSubmitting}
      >
        {isSubmitting ? 'Adding...' : 'Add Team Member'}
      </Button>
    </DialogFooter>
  );
};
