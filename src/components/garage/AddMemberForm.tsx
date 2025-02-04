import React from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface AddMemberFormProps {
  garageId: string;
  onSuccess?: () => void;
}

interface FormData {
  email: string;
}

export const AddMemberForm = ({ garageId, onSuccess }: AddMemberFormProps) => {
  const { register, handleSubmit, reset } = useForm<FormData>();
  const { toast } = useToast();

  const onSubmit = async (data: FormData) => {
    try {
      const { data: profile, error: userError } = await supabase
        .from('profiles')
        .select('id')
        .eq('email', data.email)
        .single();

      if (userError || !profile) {
        throw new Error('User not found');
      }

      const { error } = await supabase
        .from('garage_members')
        .insert({
          user_id: profile.id,
          garage_id: garageId,
        });

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Member added successfully',
      });

      reset();
      if (onSuccess) onSuccess();
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to add member',
        variant: 'destructive',
      });
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <Label htmlFor="email">Member Email</Label>
        <Input
          id="email"
          type="email"
          {...register('email', { required: true })}
          placeholder="Enter member's email"
        />
      </div>
      <Button type="submit">Add Member</Button>
    </form>
  );
};