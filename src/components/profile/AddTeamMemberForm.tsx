import React from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface AddTeamMemberFormProps {
  onSuccess?: () => void;
}

type MemberType = 'employee' | 'contractor' | 'intern' | 'partner' | 'collaborator';

interface FormData {
  email: string;
  memberType: MemberType;
  department?: string;
  position?: string;
}

export const AddTeamMemberForm = ({ onSuccess }: AddTeamMemberFormProps) => {
  const { register, handleSubmit, reset, setValue } = useForm<FormData>();
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
        .from('team_members')
        .insert({
          profile_id: profile.id,
          member_type: data.memberType,
          department: data.department,
          position: data.position,
        });

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Team member added successfully',
      });

      reset();
      if (onSuccess) onSuccess();
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to add team member',
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

      <div>
        <Label htmlFor="memberType">Member Type</Label>
        <Select onValueChange={(value: MemberType) => setValue('memberType', value)}>
          <SelectTrigger>
            <SelectValue placeholder="Select member type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="employee">Employee</SelectItem>
            <SelectItem value="contractor">Contractor</SelectItem>
            <SelectItem value="intern">Intern</SelectItem>
            <SelectItem value="partner">Partner</SelectItem>
            <SelectItem value="collaborator">Collaborator</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label htmlFor="department">Department</Label>
        <Input
          id="department"
          {...register('department')}
          placeholder="Enter department"
        />
      </div>

      <div>
        <Label htmlFor="position">Position</Label>
        <Input
          id="position"
          {...register('position')}
          placeholder="Enter position"
        />
      </div>

      <Button type="submit">Add Team Member</Button>
    </form>
  );
};