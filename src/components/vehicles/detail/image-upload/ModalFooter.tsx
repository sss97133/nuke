
import React from 'react';
import { Upload } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { ModalFooterProps } from './types';

export const ModalFooter: React.FC<ModalFooterProps> = ({ 
  handleSubmit, 
  hasSelectedFiles,
  onOpenChange
}) => {
  return (
    <DialogFooter>
      <Button 
        variant="outline" 
        onClick={() => onOpenChange(false)}
      >
        Cancel
      </Button>
      <Button 
        onClick={handleSubmit}
        disabled={!hasSelectedFiles}
      >
        <Upload className="h-4 w-4 mr-2" />
        Submit Images
      </Button>
    </DialogFooter>
  );
};
