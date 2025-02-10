
import React from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

// Simple prop types without nesting
type AddMemberFormProps = {
  garageId: string;
  onSuccess?: () => void;
  onCancel?: () => void;
};

// Basic form data type
type FormData = {
  email: string;
};

// Simplified form submission type
type SubmitFn = (data: FormData) => Promise<void>;

export const AddMemberForm = ({ garageId, onSuccess, onCancel }: AddMemberFormProps) => {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormData>();
  
  const { toast } = useToast();

  // Explicitly typed submission handler
  const handleFormSubmit: SubmitFn = async (data) => {
    try {
      const { data: userData, error: userError } = await supabase
        .from('profiles')
        .select('id')
        .eq('email', data.email)
        .single();

      if (userError || !userData) {
        toast({
          title: 'User not found',
          description: 'Please check the email address and try again',
          variant: 'destructive',
        });
        return;
      }

      const { error: memberError } = await supabase
        .from('garage_members')
        .insert({
          garage_id: garageId,
          user_id: userData.id,
        });

      if (memberError) {
        toast({
          title: 'Error adding member',
          description: memberError.message,
          variant: 'destructive',
        });
        return;
      }

      toast({
        title: 'Success',
        description: 'Member added successfully',
      });

      onSuccess?.();
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to add member',
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
          {...register('email', { required: true })}
        />
        {errors.email && (
          <span className="text-sm text-red-500">Email is required</span>
        )}
      </div>

      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit">Add Member</Button>
      </div>
    </form>
  );
};
