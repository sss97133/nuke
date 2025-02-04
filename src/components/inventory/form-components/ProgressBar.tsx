import { cn } from "@/lib/utils";

interface ProgressBarProps {
  steps: { title: string }[];
  currentStep: number;
  onStepClick: (index: number) => void;
}

export const ProgressBar = ({ steps, currentStep, onStepClick }: ProgressBarProps) => {
  return (
    <div className="mb-8">
      <div className="flex justify-between items-center mb-2 px-1">
        {steps.map((step, index) => (
          <button
            key={index}
            onClick={() => onStepClick(index)}
            className={cn(
              "text-tiny max-w-[80px] truncate hover:text-clip hover:overflow-visible transition-colors px-1",
              index === currentStep
                ? "text-foreground font-semibold"
                : "text-muted-foreground"
            )}
            title={step.title}
          >
            {step.title}
          </button>
        ))}
      </div>
      <div className="h-2 bg-secondary rounded-full">
        <div
          className="h-full bg-primary rounded-full transition-all duration-300"
          style={{
            width: `${((currentStep + 1) / steps.length) * 100}%`,
          }}
        />
      </div>
    </div>
  );
};