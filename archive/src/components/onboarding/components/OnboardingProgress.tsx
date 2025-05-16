
import { Progress } from '@/components/ui/progress';

interface OnboardingProgressProps {
  currentStep: number;
  totalSteps: number;
}

export const OnboardingProgress = ({ currentStep, totalSteps }: OnboardingProgressProps) => (
  <Progress
    value={(currentStep / (totalSteps - 1)) * 100}
    className="h-2"
  />
);
