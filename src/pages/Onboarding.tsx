
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Carousel, CarouselContent, CarouselItem } from "@/components/ui/carousel";
import { OnboardingStepCard } from '@/components/onboarding/OnboardingStepCard';
import { OnboardingLoadingState } from '@/components/onboarding/LoadingState';
import { CarouselNavigation } from '@/components/onboarding/CarouselNavigation';
import { ProgressDisplay } from '@/components/onboarding/ProgressDisplay';
import { useOnboardingCarousel } from '@/components/onboarding/useOnboardingCarousel';
import { onboardingSteps } from '@/components/onboarding/steps';

const Onboarding = () => {
  const navigate = useNavigate();
  const { 
    api, 
    setApi, 
    current, 
    loading, 
    completedSteps, 
    isCompleted,
    handleNext 
  } = useOnboardingCarousel();
  
  if (loading) {
    return <OnboardingLoadingState />;
  }
  
  return (
    <div className="container max-w-5xl mx-auto p-6">
      <Card className="border-0 shadow-none mb-6">
        <CardHeader>
          <CardTitle className="text-3xl">Welcome to Your Vehicle Manager</CardTitle>
          <CardDescription className="text-lg">
            Complete these 5 steps to get the most out of your account
          </CardDescription>
        </CardHeader>
      </Card>
      
      <ProgressDisplay 
        completedSteps={completedSteps} 
        totalSteps={onboardingSteps.length} 
      />
      
      <Carousel className="w-full" setApi={setApi}>
        <CarouselContent>
          {onboardingSteps.map((step, index) => (
            <CarouselItem key={index}>
              <OnboardingStepCard
                index={index}
                step={step}
                current={current}
                isCompleted={completedSteps.includes(index)}
                api={api}
                totalSteps={onboardingSteps.length}
                onNext={handleNext}
              />
            </CarouselItem>
          ))}
        </CarouselContent>
        
        <CarouselNavigation 
          steps={onboardingSteps} 
          current={current} 
          api={api} 
        />
      </Carousel>
      
      <div className="mt-8 text-center">
        <Button variant="link" onClick={() => navigate('/dashboard')}>
          Skip onboarding for now
        </Button>
      </div>
    </div>
  );
};

export default Onboarding;
