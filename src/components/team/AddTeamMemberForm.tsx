
import React from 'react';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogHeader, 
  DialogTitle,
} from "@/components/ui/dialog";
import { FormFields } from './components/FormFields';
import { FormActions } from './components/FormActions';
import { useTeamMemberForm } from './hooks/useTeamMemberForm';
import { AddTeamMemberFormProps } from './types/TeamMemberTypes';

export const AddTeamMemberForm: React.FC<AddTeamMemberFormProps> = ({ 
  open, 
  onOpenChange,
  onSuccess
}) => {
  console.log("AddTeamMemberForm rendering, open:", open, "with props:", { open, onSuccess });
  
  const {
    formData,
    isSubmitting,
    handleInputChange,
    handleSelectChange,
    handleSubmit,
    resetForm,
  } = useTeamMemberForm(onOpenChange, onSuccess);

  console.log("Form state - isSubmitting:", isSubmitting);

  // Handle dialog close properly - reset form when dialog is closed
  const handleOpenChange = (newOpenState: boolean) => {
    console.log("Dialog onOpenChange triggered:", newOpenState, "isSubmitting:", isSubmitting);
    
    if (!newOpenState && !isSubmitting) {
      // Only reset if we're closing and not in the middle of submitting
      console.log("Dialog closing - resetting form");
      resetForm();
    }
    
    if (isSubmitting && !newOpenState) {
      console.log("Preventing dialog close while submitting");
      return; // Prevent closing while submitting
    }
    
    onOpenChange(newOpenState);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Add Team Member</DialogTitle>
          <DialogDescription>
            Add a new member to your team. Fill out the information below.
          </DialogDescription>
        </DialogHeader>
        
        <form onSubmit={(e) => {
          console.log("Form onSubmit triggered");
          e.preventDefault(); // Ensure default form submission is prevented
          handleSubmit(e);
        }}>
          <FormFields 
            formData={formData}
            handleInputChange={handleInputChange}
            handleSelectChange={handleSelectChange}
          />
          
          <FormActions isSubmitting={isSubmitting} />
        </form>
      </DialogContent>
    </Dialog>
  );
};
