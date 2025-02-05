import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Card } from '@/components/ui/card';
import { BasicInfoStep } from './steps/BasicInfoStep';
import { ProfilePictureStep } from './steps/ProfilePictureStep';
import { UserTypeStep } from './steps/UserTypeStep';
import { LinksStep } from './steps/LinksStep';
import { SkillsStep } from './steps/SkillsStep';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';

const STEPS = [
  { id: 'basic-info', title: 'Basic Information' },
  { id: 'profile-picture', title: 'Profile Picture' },
  { id: 'user-type', title: 'User Type' },
  { id: 'links', title: 'Social Links' },
  { id: 'skills', title: 'Skills & Interests' }
];

export const OnboardingWizard = () => {
  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState({
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
    skills: [] as string[]
  });
  
  const navigate = useNavigate();
  const { toast } = useToast();

  const updateFormData = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleNext = () => {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(prev => prev + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1);
    }
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

  const renderStep = () => {
    switch (currentStep) {
      case 0:
        return (
          <BasicInfoStep
            fullName={formData.fullName}
            username={formData.username}
            onUpdate={updateFormData}
          />
        );
      case 1:
        return (
          <ProfilePictureStep
            avatarUrl={formData.avatarUrl}
            onUpdate={(url) => updateFormData('avatarUrl', url)}
          />
        );
      case 2:
        return (
          <UserTypeStep
            userType={formData.userType}
            onUpdate={(type) => updateFormData('userType', type)}
          />
        );
      case 3:
        return (
          <LinksStep
            socialLinks={formData.socialLinks}
            streamingLinks={formData.streamingLinks}
            onUpdateSocial={(links) => updateFormData('socialLinks', links)}
            onUpdateStreaming={(links) => updateFormData('streamingLinks', links)}
          />
        );
      case 4:
        return (
          <SkillsStep
            skills={formData.skills}
            onUpdate={(skills) => updateFormData('skills', skills)}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl p-6 space-y-6">
        <div className="space-y-2">
          <h2 className="text-2xl font-bold tracking-tight">
            {STEPS[currentStep].title}
          </h2>
          <p className="text-muted-foreground">
            Step {currentStep + 1} of {STEPS.length}
          </p>
        </div>

        <Progress
          value={(currentStep / (STEPS.length - 1)) * 100}
          className="h-2"
        />

        <div className="min-h-[300px]">
          {renderStep()}
        </div>

        <div className="flex justify-between pt-4">
          <Button
            variant="outline"
            onClick={handleBack}
            disabled={currentStep === 0}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>

          {currentStep === STEPS.length - 1 ? (
            <Button onClick={handleComplete}>
              <Check className="mr-2 h-4 w-4" />
              Complete
            </Button>
          ) : (
            <Button onClick={handleNext}>
              Next
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
};