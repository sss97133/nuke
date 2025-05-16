
import React from 'react';
import { Check, X } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { DialogClose } from "@/components/ui/dialog";

interface ModalActionsProps {
  handleConnect: () => void;
  isUploading: boolean;
}

export const ModalActions: React.FC<ModalActionsProps> = ({ handleConnect, isUploading }) => {
  return (
    <div className="sm:justify-between flex justify-end space-x-2">
      <DialogClose asChild>
        <Button type="button" variant="outline">
          <X className="h-4 w-4 mr-2" />
          Cancel
        </Button>
      </DialogClose>
      <Button 
        type="button" 
        onClick={handleConnect}
        disabled={isUploading}
      >
        <Check className="h-4 w-4 mr-2" />
        Connect
      </Button>
    </div>
  );
};
