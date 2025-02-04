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

interface FormData {
  email: string;
}

export const AddMemberForm = ({ garageId, onSuccess }: AddMemberFormProps) => {
  const { register, handleSubmit, reset } = useForm<FormData>();
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
          title: 'Error',
          description: 'User not found',
          variant: 'destructive',
        });
        return;
      }

      const { error: memberError } = await supabase
        .from('garage_members')
        .insert([
          {
            garage_id: garageId,
            user_id: userData.id,
          },
        ]);

      if (memberError) {
        toast({
          title: 'Error',
          description: 'Failed to add member',
          variant: 'destructive',
        });
        return;
      }

      toast({
        title: 'Success',
        description: 'Member added successfully',
      });

      reset();
      if (onSuccess) {
        onSuccess();
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'An unexpected error occurred',
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
          placeholder="Enter member email"
        />
      </div>
      <Button type="submit">Add Member</Button>
    </form>
  );
};