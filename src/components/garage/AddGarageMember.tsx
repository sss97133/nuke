import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, UserPlus } from "lucide-react";

interface AddGarageMemberProps {
  garageId: string;
  onMemberAdded: () => void;
}

export const AddGarageMember = ({ garageId, onMemberAdded }: AddGarageMemberProps) => {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const { toast } = useToast();

  const handleAddMember = async () => {
    setIsLoading(true);
    try {
      // First find the user by email
      const { data: profiles, error: profileError } = await supabase
        .from('profiles')
        .select('id')
        .eq('email', email)
        .single();

      if (profileError || !profiles) {
        throw new Error('User not found');
      }

      // Add the user as a garage member
      const { error: memberError } = await supabase
        .from('garage_members')
        .insert({
          garage_id: garageId,
          user_id: profiles.id
        });

      if (memberError) throw memberError;

      toast({
        title: "Success",
        description: "Member added successfully"
      });
      
      onMemberAdded();
      setIsOpen(false);
      setEmail("");
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
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
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium">Email</label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter member's email"
            />
          </div>
          <Button 
            onClick={handleAddMember}
            disabled={isLoading || !email}
            className="w-full"
          >
            {isLoading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Add Member
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};