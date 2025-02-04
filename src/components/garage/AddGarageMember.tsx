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
  onMemberAdded?: () => void;
}

export const AddGarageMember = ({ garageId, onMemberAdded }: AddGarageMemberProps) => {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" className="w-full">
          <UserPlus className="w-4 h-4 mr-2" />
          Add Member
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Garage Member</DialogTitle>
        </DialogHeader>
        <AddMemberForm garageId={garageId} onMemberAdded={onMemberAdded} />
      </DialogContent>
    </Dialog>
  );
};