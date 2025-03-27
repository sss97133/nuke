
import type { Database } from '../types';
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

export type UserType = 'viewer' | 'professional';

export interface OnboardingFormData {
  firstName: string;
  lastName: string;
  username: string;
  email: string;
  avatarUrl: string;
  userType: UserType;
  socialLinks: {
    twitter: string;
    instagram: string;
    linkedin: string;
    github: string;
  };
  streamingLinks: {
    twitch: string;
    youtube: string;
    tiktok: string;
  };
  skills: string[];
}

export const useOnboardingForm = () => {
  const [formData, setFormData] = useState<OnboardingFormData>({
    firstName: '',
    lastName: '',
    username: '',
    email: '',
    avatarUrl: '',
    userType: 'viewer',
    socialLinks: {
      twitter: '',
      instagram: '',
      linkedin: '',
      github: ''
    },
    streamingLinks: {
      twitch: '',
      youtube: '',
      tiktok: ''
    },
    skills: []
  });

  const navigate = useNavigate();
  const { toast } = useToast();

  // Load pre-filled data from GitHub if available
  useEffect(() => {
    const savedData = localStorage.getItem('onboarding_data');
    if (savedData) {
      const parsedData = JSON.parse(savedData);
      setFormData(prev => ({
        ...prev,
        ...parsedData
      }));
      // Clear the saved data after using it
      localStorage.removeItem('onboarding_data');
    }
  }, []);

  const updateFormData = (field: keyof OnboardingFormData, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleComplete = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
  if (error) console.error("Database query error:", error);
      if (!user) throw new Error('No user found');

      const { error } = await supabase
        .from('profiles')
        .update({
          first_name: formData.firstName,
          last_name: formData.lastName,
          username: formData.username,
          avatar_url: formData.avatarUrl,
          user_type: formData.userType,
          social_links: formData.socialLinks,
          streaming_links: formData.streamingLinks,
          skills: formData.skills,
          onboarding_completed: true
        })
        .eq('id', user.id);

      if (error) throw error;

      toast({
        title: 'Profile Updated',
        description: 'Your profile has been successfully set up!',
      });

      navigate('/dashboard');
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to update profile. Please try again.',
        variant: 'destructive',
      });
    }
  };

  return {
    formData,
    updateFormData,
    handleComplete
  };
};
