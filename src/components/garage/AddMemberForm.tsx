import React from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface AddMemberFormProps {
  garageId: string;
  onSuccess?: () => void;
}

type FormData = {
  email: string;
};

export const AddMemberForm = ({ garageId, onSuccess }: AddMemberFormProps) => {
  const { register, handleSubmit, formState: { errors } } = useForm<FormData>();
  const { toast } = useToast();

  const onSubmit = async (data: FormData) => {
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

      if (onSuccess) {
        onSuccess();
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to add member',
        variant: 'destructive',
      });
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
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
      <Button type="submit">Add Member</Button>
    </form>
  );
};