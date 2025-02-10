
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

export type UserType = 'viewer' | 'professional';

export interface OnboardingFormData {
  fullName: string;
  username: string;
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
    fullName: '',
    username: '',
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

  const updateFormData = (field: keyof OnboardingFormData, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleComplete = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No user found');

      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: formData.fullName,
          username: formData.username,
          avatar_url: formData.avatarUrl,
          user_type: formData.userType,
          social_links: formData.socialLinks,
          streaming_links: formData.streamingLinks
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
