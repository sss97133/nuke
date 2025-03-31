import type { Database } from '../types';
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
    console.log(`Input changed: ${name} = ${value}`);
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSelectChange = (name: string, value: string) => {
    console.log(`Select changed: ${name} = ${value}`);
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const resetForm = () => {
    console.log("Resetting form data");
    setFormData({
      fullName: '',
      email: '',
      position: '',
      memberType: 'employee',
      department: '',
      status: 'active',
    });
    setIsSubmitting(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    console.log("Form submission started", formData);
    
    if (isSubmitting) {
      console.log("Already submitting, ignoring duplicate submission");
      return;
    }
    
    setIsSubmitting(true);
    console.log("Set isSubmitting to true");

    try {
      console.log("Getting current user session");
      // Get the current user to use their auth session
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      
      if (sessionError) {
        console.error("Session error:", sessionError);
        throw sessionError;
      }
      
      console.log("Session retrieved", session ? "Valid session" : "No session");
      
      // Force creation of a new profile instead of looking up existing one
      console.log("Creating new profile for:", formData.fullName);
      const newId = crypto.randomUUID();
      console.log("Generated new profile ID:", newId);
      
      // Declare a variable to hold the profile data
      let profileData;
      
      const { data, error: createError } = await supabase
        .from('profiles')
        .insert({
          id: newId,
          full_name: formData.fullName,
          email: formData.email
        })
        .select('id')
        .single();

      if (createError) {
        console.error("Error creating profile:", createError);
        // Check if it's a duplicate key error
        if (createError.code === '23505' || createError.message.includes('duplicate key')) {
          console.log("Profile with this email might already exist, checking...");
          const { data: existingProfile, error: fetchError } = await supabase
            .from('profiles')
            .select('id')
            .eq('email', formData.email)
            .maybeSingle();

          if (fetchError) {
            console.error("Error fetching profile:", fetchError);
            throw fetchError;
          }
          
          if (!existingProfile) {
            console.error("Could not create or find profile");
            throw new Error("Failed to create profile and could not find existing one");
          }
          
          console.log("Found existing profile:", existingProfile);
          // Use existing profile ID
          profileData = existingProfile;
        } else {
          throw createError;
        }
      } else {
        // Use the newly created profile
        profileData = data;
      }
      
      if (!profileData) {
        throw new Error("Failed to create profile - no profile data returned");
      }
      
      console.log("Profile created/found successfully:", profileData);
      const profileId = profileData.id;

      // Now create the team member with reference to profile
      console.log("Creating team member with profile ID:", profileId);
      const { data: teamMember, error: teamMemberError } = await supabase
        .from('team_members')
        .insert({
          profile_id: profileId,
          position: formData.position,
          member_type: formData.memberType as MemberType,
          department: formData.department || null,
          status: formData.status,
          start_date: new Date().toISOString(),
        })
        .select()
        .single();

      if (teamMemberError) {
        console.error("Error creating team member:", teamMemberError);
        throw teamMemberError;
      }

      console.log("Team member created successfully:", teamMember);
      
      // Invalidate team members query to refresh data
      console.log("Invalidating team members query");
      queryClient.invalidateQueries({ queryKey: ['team-members'] });

      toast({
        title: "Team member added",
        description: `${formData.fullName} has been added to your team.`,
      });
      
      // Reset form
      resetForm();

      // Call success callback first, then close dialog
      console.log("Calling onSuccess callback:", !!onSuccess);
      if (onSuccess) onSuccess();
      
      console.log("Closing dialog");
      onOpenChange(false);
      
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to add team member');
      console.error('Error adding team member:', error);
      toast({
        title: "Failed to add team member",
        description: error.message,
        variant: "destructive",
      });
      
      // Reset isSubmitting state so form can be submitted again
      setIsSubmitting(false);
    }
  };

  return {
    formData,
    isSubmitting,
    handleInputChange,
    handleSelectChange,
    handleSubmit,
    resetForm,
  };
};
