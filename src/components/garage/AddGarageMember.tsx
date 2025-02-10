
import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useForm } from 'react-hook-form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { UserPlus } from 'lucide-react';

interface AddGarageMemberProps {
  garageId: string;
  onMemberAdded: () => void;
}

type FormData = {
  email: string;
};

interface ProfileData {
  id: string;
  email: string | null;
}

export const AddGarageMember = ({ garageId, onMemberAdded }: AddGarageMemberProps) => {
  const [open, setOpen] = React.useState(false);
  const { toast } = useToast();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset
  } = useForm<FormData>();

  const checkGarageAccess = async (userId: string) => {
    const { data, error } = await supabase
      .from('garage_members')
      .select('id')
      .eq('garage_id', garageId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw new Error('Failed to check garage access');
    return !!data;
  };

  const findUserByEmail = async (email: string): Promise<ProfileData | null> => {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email')
      .eq('email', email)
      .maybeSingle();

    if (error) throw new Error('Failed to check user existence');
    return data;
  };

  const checkExistingMembership = async (userId: string) => {
    const { data, error } = await supabase
      .from('garage_members')
      .select('id')
      .eq('garage_id', garageId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw new Error('Failed to check existing membership');
    return !!data;
  };

  const addGarageMember = async (userId: string) => {
    const { error } = await supabase
      .from('garage_members')
      .insert({
        garage_id: garageId,
        user_id: userId,
      });

    if (error) throw new Error('Failed to add member');
  };

  const handleFormSubmit = async (data: FormData) => {
    try {
      // Get current user
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) {
        throw new Error('Authentication error');
      }

      // Check if current user has access to this garage
      const hasAccess = await checkGarageAccess(user.id);
      if (!hasAccess) {
        throw new Error('You do not have permission to add members to this garage');
      }

      // Find user by email
      const profile = await findUserByEmail(data.email);
      if (!profile) {
        throw new Error('No user found with this email address');
      }

      // Check if user is already a member
      const isExistingMember = await checkExistingMembership(profile.id);
      if (isExistingMember) {
        throw new Error('This user is already a member of this garage');
      }

      // Add the new member
      await addGarageMember(profile.id);

      toast({
        title: 'Success',
        description: 'Member added successfully',
      });

      reset();
      onMemberAdded();
      setOpen(false);
      
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'An unexpected error occurred',
        variant: 'destructive',
      });
    }
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
        <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              {...register('email', { 
                required: 'Email is required',
                pattern: {
                  value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i,
                  message: "Invalid email address"
                }
              })}
              disabled={isSubmitting}
              placeholder="Enter member's email"
            />
            {errors.email && (
              <span className="text-sm text-red-500">{errors.email.message}</span>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button 
              type="button" 
              variant="outline" 
              onClick={() => setOpen(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Adding...' : 'Add Member'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
