
import { cn } from "@/lib/utils";

interface ProgressBarProps {
  steps: { title: string }[];
  currentStep: number;
  onStepClick: (index: number) => void;
}

export const ProgressBar = ({ steps, currentStep, onStepClick }: ProgressBarProps) => {
  return (
    <div className="mb-6 border-b border-border">
      <div className="flex items-center gap-4 px-2">
        <span className="text-sm font-medium">
          Step {currentStep + 1} of {steps.length}
        </span>
        <span className="text-sm text-muted-foreground">
          {steps[currentStep].title}
        </span>
      </div>
    </div>
  );
};
