
import { Button } from '@/components/ui/button';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';

interface OnboardingNavigationProps {
  currentStep: number;
  totalSteps: number;
  onNext: () => void;
  onBack: () => void;
  onComplete: () => void;
}

export const OnboardingNavigation = ({
  currentStep,
  totalSteps,
  onNext,
  onBack,
  onComplete
}: OnboardingNavigationProps) => (
  <div className="flex justify-between pt-4">
    <Button
      variant="outline"
      onClick={onBack}
      disabled={currentStep === 0}
    >
      <ArrowLeft className="mr-2 h-4 w-4" />
      Back
    </Button>

    {currentStep === totalSteps - 1 ? (
      <Button onClick={onComplete}>
        <Check className="mr-2 h-4 w-4" />
        Complete
      </Button>
    ) : (
      <Button onClick={onNext}>
        Next
        <ArrowRight className="ml-2 h-4 w-4" />
      </Button>
    )}
  </div>
);
