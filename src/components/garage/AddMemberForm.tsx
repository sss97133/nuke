import React from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface AddMemberFormProps {
  garageId: string;
  onMemberAdded?: () => void;
}

interface FormData {
  email: string;
}

export const AddMemberForm = ({ garageId, onMemberAdded }: AddMemberFormProps) => {
  const { register, handleSubmit, reset } = useForm<FormData>();
  const { toast } = useToast();

  const onSubmit = async (data: FormData) => {
    try {
      const { data: user, error: userError } = await supabase
        .from('profiles')
        .select('id')
        .eq('email', data.email)
        .single();

      if (userError || !user) {
        throw new Error('User not found');
      }

      const { error } = await supabase
        .from('garage_members')
        .insert({ garage_id: garageId, user_id: user.id });

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Member added successfully',
      });

      reset();
      if (onMemberAdded) onMemberAdded();
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
      <Input
        {...register('email')}
        type="email"
        placeholder="Member's email"
        required
      />
      <Button type="submit">Add Member</Button>
    </form>
  );
};