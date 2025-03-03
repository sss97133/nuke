
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
  const {
    formData,
    isSubmitting,
    handleInputChange,
    handleSelectChange,
    handleSubmit,
  } = useTeamMemberForm(onOpenChange, onSuccess);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Add Team Member</DialogTitle>
          <DialogDescription>
            Add a new member to your team. Fill out the information below.
          </DialogDescription>
        </DialogHeader>
        
        <form onSubmit={handleSubmit}>
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
