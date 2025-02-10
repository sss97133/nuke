
import React from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

type AddMemberFormProps = {
  garageId: string;
  onSuccess?: () => void;
  onCancel?: () => void;
};

type FormData = {
  email: string;
};

type SubmitFn = (data: FormData) => Promise<void>;

export const AddMemberForm = ({ garageId, onSuccess, onCancel }: AddMemberFormProps) => {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset
  } = useForm<FormData>();
  
  const { toast } = useToast();

  const handleFormSubmit: SubmitFn = async (data) => {
    try {
      // Get the current user
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      
      if (userError || !user) {
        toast({
          title: 'Authentication Error',
          description: 'Failed to get current user',
          variant: 'destructive',
        });
        return;
      }

      // First check if the user has permission to add members to this garage
      const { data: garageAccess, error: accessError } = await supabase
        .from('garage_members')
        .select('id')
        .eq('garage_id', garageId)
        .eq('user_id', user.id)
        .maybeSingle();

      if (accessError || !garageAccess) {
        toast({
          title: 'Access Denied',
          description: 'You do not have permission to add members to this garage',
          variant: 'destructive',
        });
        return;
      }

      // Check if user exists
      const { data: userData, error: userError2 } = await supabase
        .from('profiles')
        .select('id')
        .eq('email', data.email)
        .maybeSingle();

      if (userError2) {
        toast({
          title: 'Error',
          description: 'Failed to check user existence',
          variant: 'destructive',
        });
        return;
      }

      if (!userData) {
        toast({
          title: 'User not found',
          description: 'No user found with this email address',
          variant: 'destructive',
        });
        return;
      }

      // Check if user is already a member
      const { data: existingMember, error: memberCheckError } = await supabase
        .from('garage_members')
        .select('id')
        .eq('garage_id', garageId)
        .eq('user_id', userData.id)
        .maybeSingle();

      if (memberCheckError) {
        toast({
          title: 'Error',
          description: 'Failed to check existing membership',
          variant: 'destructive',
        });
        return;
      }

      if (existingMember) {
        toast({
          title: 'Already a member',
          description: 'This user is already a member of this garage',
          variant: 'destructive',
        });
        return;
      }

      // Add the new member
      const { error: insertError } = await supabase
        .from('garage_members')
        .insert({
          garage_id: garageId,
          user_id: userData.id,
        });

      if (insertError) {
        toast({
          title: 'Error adding member',
          description: insertError.message,
          variant: 'destructive',
        });
        return;
      }

      toast({
        title: 'Success',
        description: 'Member added successfully',
      });

      reset();
      onSuccess?.();
    } catch (error) {
      toast({
        title: 'Error',
        description: 'An unexpected error occurred',
        variant: 'destructive',
      });
    }
  };

  return (
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
        {onCancel && (
          <Button 
            type="button" 
            variant="outline" 
            onClick={onCancel}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Adding...' : 'Add Member'}
        </Button>
      </div>
    </form>
  );
};
