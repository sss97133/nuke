import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { UserPlus } from "lucide-react";
import { AddMemberForm } from "./AddMemberForm";
import type { AddGarageMemberProps } from "@/types/garage";

export const AddGarageMember = ({ garageId, onMemberAdded }: AddGarageMemberProps) => {
  const [isOpen, setIsOpen] = useState(false);

  const handleMemberAdded = () => {
    onMemberAdded();
    setIsOpen(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <UserPlus className="h-4 w-4 mr-2" />
          Add Member
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Garage Member</DialogTitle>
        </DialogHeader>
        <AddMemberForm garageId={garageId} onMemberAdded={handleMemberAdded} />
      </DialogContent>
    </Dialog>
  );
};