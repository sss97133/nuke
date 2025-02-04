import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { UserPlus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";

type AddGarageMemberProps = {
  garageId: string;
};

type Profile = {
  id: string;
  email?: string;
};

export const AddGarageMember = ({ garageId }: AddGarageMemberProps) => {
  const [newMemberEmail, setNewMemberEmail] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const handleAddMember = async () => {
    if (!newMemberEmail.trim()) {
      toast({
        title: "Error",
        description: "Member email is required",
        variant: "destructive"
      });
      return;
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', newMemberEmail)
      .single();

    if (profileError || !profile) {
      toast({
        title: "Error",
        description: "User not found",
        variant: "destructive"
      });
      return;
    }

    const { error } = await supabase
      .from('garage_members')
      .insert([{ 
        garage_id: garageId,
        user_id: profile.id
      }]);

    if (error) {
      toast({
        title: "Error",
        description: "Failed to add member",
        variant: "destructive"
      });
      return;
    }

    toast({
      title: "Success",
      description: "Member added successfully"
    });
    setNewMemberEmail("");
    queryClient.invalidateQueries({ queryKey: ['garages'] });
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <UserPlus className="w-4 h-4" />
          Add Member
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add New Member</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-4">
          <Input
            placeholder="Member Email"
            value={newMemberEmail}
            onChange={(e) => setNewMemberEmail(e.target.value)}
          />
          <Button 
            onClick={handleAddMember}
            className="w-full"
          >
            Add Member
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};