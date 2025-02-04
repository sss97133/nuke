import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { AddGarageMemberProps } from "@/types/garage";

export const AddMemberForm = ({ garageId, onMemberAdded }: AddGarageMemberProps) => {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const handleAddMember = async () => {
    if (!email) return;
    
    setIsLoading(true);
    try {
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id')
        .eq('email', email)
        .limit(1)
        .maybeSingle();

      if (profileError) {
        throw new Error('User not found');
      }

      if (!profile) {
        throw new Error('No profile found');
      }

      const { error: memberError } = await supabase
        .from('garage_members')
        .insert({
          garage_id: garageId,
          user_id: profile.id
        });

      if (memberError) {
        throw memberError;
      }

      toast({
        title: "Success",
        description: "Member added successfully"
      });
      
      onMemberAdded();
      setEmail("");
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : 'An error occurred',
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
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
  );
};