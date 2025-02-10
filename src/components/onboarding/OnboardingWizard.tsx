
import React, { useState } from 'react';
import { Card } from '@/components/ui/card';
import { BasicInfoStep } from './steps/BasicInfoStep';
import { ProfilePictureStep } from './steps/ProfilePictureStep';
import { UserTypeStep } from './steps/UserTypeStep';
import { LinksStep } from './steps/LinksStep';
import { SkillsStep } from './steps/SkillsStep';
import { OnboardingProgress } from './components/OnboardingProgress';
import { OnboardingNavigation } from './components/OnboardingNavigation';
import { useOnboardingForm } from './hooks/useOnboardingForm';

const STEPS = [
  { id: 'basic-info', title: 'Basic Information' },
  { id: 'profile-picture', title: 'Profile Picture' },
  { id: 'user-type', title: 'User Type' },
  { id: 'links', title: 'Social Links' },
  { id: 'skills', title: 'Skills & Interests' }
];

export const OnboardingWizard = () => {
  const [currentStep, setCurrentStep] = useState(0);
  const { formData, updateFormData, handleComplete } = useOnboardingForm();

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

  const renderStep = () => {
    switch (currentStep) {
      case 0:
        return (
          <BasicInfoStep
            firstName={formData.firstName}
            lastName={formData.lastName}
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

        <OnboardingProgress
          currentStep={currentStep}
          totalSteps={STEPS.length}
        />

        <div className="min-h-[300px]">
          {renderStep()}
        </div>

        <OnboardingNavigation
          currentStep={currentStep}
          totalSteps={STEPS.length}
          onNext={handleNext}
          onBack={handleBack}
          onComplete={handleComplete}
        />
      </Card>
    </div>
  );
};

