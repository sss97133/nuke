
import React from 'react';
import { Info, ArrowLeft, ArrowRight } from 'lucide-react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { OnboardingStepIcon } from './OnboardingStepIcon';
import { type CarouselApi } from "@/components/ui/carousel";

interface OnboardingStepCardProps {
  index: number;
  step: {
    icon: React.ElementType;
    title: string;
    description: string;
    content: string;
  };
  current: number;
  isCompleted: boolean;
  api: CarouselApi | null;
  totalSteps: number;
  onNext: () => void;
}

export const OnboardingStepCard: React.FC<OnboardingStepCardProps> = ({
  index,
  step,
  current,
  isCompleted,
  api,
  totalSteps,
  onNext
}) => {
  const isActive = current === index;
  
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-4">
          <OnboardingStepIcon 
            icon={step.icon} 
            completed={isCompleted} 
            active={isActive} 
          />
          <div>
            <CardTitle>{step.title}</CardTitle>
            <CardDescription>{step.description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="min-h-[200px]">
        <div className="space-y-4">
          <div className="flex items-start gap-2">
            <Info className="h-5 w-5 text-muted-foreground mt-0.5 flex-shrink-0" />
            <p className="text-muted-foreground">{step.content}</p>
          </div>
        </div>
      </CardContent>
      <CardFooter className="flex justify-between">
        <Button
          variant="outline"
          onClick={() => api?.scrollPrev()}
          disabled={index === 0}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Previous
        </Button>
        <Button onClick={onNext}>
          {index === totalSteps - 1 ? (
            isCompleted ? "Go to Dashboard" : "Complete Onboarding"
          ) : (
            <>
              Next
              <ArrowRight className="ml-2 h-4 w-4" />
            </>
          )}
        </Button>
      </CardFooter>
    </Card>
  );
};
