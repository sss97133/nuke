import React from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface AddMemberFormProps {
  garageId: string;
  onSuccess?: () => void;
}

interface FormValues {
  email: string;
}

export const AddMemberForm = ({ garageId, onSuccess }: AddMemberFormProps) => {
  const { register, handleSubmit, reset } = useForm<FormValues>();
  const { toast } = useToast();

  const onSubmit = async (data: FormValues) => {
    try {
      const { data: userData, error: userError } = await supabase
        .from('profiles')
        .select('id')
        .eq('email', data.email)
        .maybeSingle();

      if (userError || !userData) {
        throw new Error('User not found');
      }

      const { error: memberError } = await supabase
        .from('garage_members')
        .insert({ user_id: userData.id, garage_id: garageId });

      if (memberError) throw memberError;

      toast({
        title: 'Success',
        description: 'Member added successfully',
      });

      reset();
      if (onSuccess) onSuccess();
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