import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AddMemberForm } from './AddMemberForm';
import { UserPlus } from 'lucide-react';

interface AddGarageMemberProps {
  garageId: string;
  onMemberAdded: () => void;
}

export const AddGarageMember = ({ garageId, onMemberAdded }: AddGarageMemberProps) => {
  const [open, setOpen] = React.useState(false);

  const handleSuccess = () => {
    onMemberAdded();
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <UserPlus className="w-4 h-4" />
          Add Member
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Garage Member</DialogTitle>
        </DialogHeader>
        <AddMemberForm 
          garageId={garageId} 
          onSuccess={handleSuccess}
          onCancel={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
};