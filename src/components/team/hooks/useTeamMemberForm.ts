
import { useState } from 'react';
import { useToast } from "@/hooks/use-toast";
import { supabase } from '@/integrations/supabase/client';
import { TeamMemberFormData, MemberType } from '../types/TeamMemberTypes';
import { useQueryClient } from '@tanstack/react-query';

export const useTeamMemberForm = (onOpenChange: (open: boolean) => void, onSuccess?: () => void) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState<TeamMemberFormData>({
    fullName: '',
    email: '',
    position: '',
    memberType: 'employee',
    department: '',
    status: 'active',
  });

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSelectChange = (name: string, value: string) => {
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      // Create a profile record first
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .insert({
          full_name: formData.fullName,
          email: formData.email,
        })
        .select('id')
        .single();

      if (profileError) throw profileError;

      // Now create the team member with reference to profile
      const { error: teamMemberError } = await supabase
        .from('team_members')
        .insert({
          profile_id: profileData.id,
          position: formData.position,
          member_type: formData.memberType as MemberType,
          department: formData.department || null,
          status: formData.status,
          start_date: new Date().toISOString(),
        });

      if (teamMemberError) throw teamMemberError;

      // Invalidate team members query to refresh data
      queryClient.invalidateQueries(['team-members']);

      toast({
        title: "Team member added",
        description: `${formData.fullName} has been added to your team.`,
      });
      
      // Reset form
      setFormData({
        fullName: '',
        email: '',
        position: '',
        memberType: 'employee',
        department: '',
        status: 'active',
      });

      // Close dialog and trigger success callback if provided
      onOpenChange(false);
      if (onSuccess) onSuccess();
      
    } catch (error: any) {
      console.error('Error adding team member:', error);
      toast({
        title: "Failed to add team member",
        description: error.message || "An error occurred while adding the team member.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    formData,
    isSubmitting,
    handleInputChange,
    handleSelectChange,
    handleSubmit,
  };
};
