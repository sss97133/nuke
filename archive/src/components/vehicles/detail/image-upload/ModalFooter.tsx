
import React from 'react';
import { Upload, Loader2 } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { ModalFooterProps } from './types';

export const ModalFooter: React.FC<ModalFooterProps> = ({ 
  handleSubmit, 
  hasSelectedFiles,
  onOpenChange,
  isLoading = false
}) => {
  return (
    <DialogFooter>
      <Button 
        variant="outline" 
        onClick={() => onOpenChange(false)}
        disabled={isLoading}
      >
        Cancel
      </Button>
      <Button 
        onClick={handleSubmit}
        disabled={!hasSelectedFiles || isLoading}
      >
        {isLoading ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Uploading...
          </>
        ) : (
          <>
            <Upload className="h-4 w-4 mr-2" />
            Upload Images
          </>
        )}
      </Button>
    </DialogFooter>
  );
};
