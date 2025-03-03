
import { useState } from 'react';
import { useToast } from "@/hooks/use-toast";
import { supabase } from '@/integrations/supabase/client';
import { TeamMemberFormData, MemberType } from '../types/TeamMemberTypes';

export const useTeamMemberForm = (onOpenChange: (open: boolean) => void, onSuccess?: () => void) => {
  const { toast } = useToast();
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
      // For this example, we'll directly create a team member entry
      const { data, error } = await supabase
        .from('team_members')
        .insert({
          full_name: formData.fullName,
          email: formData.email,
          position: formData.position,
          member_type: formData.memberType as MemberType, // Ensure correct type
          department: formData.department || null,
          status: formData.status,
          start_date: new Date().toISOString(),
        })
        .select();

      if (error) throw error;

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
      
    } catch (error) {
      console.error('Error adding team member:', error);
      toast({
        title: "Failed to add team member",
        description: "An error occurred while adding the team member.",
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
