import { cn } from "@/lib/utils";

interface ProgressBarProps {
  steps: { title: string }[];
  currentStep: number;
  onStepClick: (index: number) => void;
}

export const ProgressBar = ({ steps, currentStep, onStepClick }: ProgressBarProps) => {
  return (
    <div className="mb-8">
      <div className="grid grid-cols-7 gap-1 mb-2">
        {steps.map((step, index) => (
          <button
            key={index}
            onClick={() => onStepClick(index)}
            className={cn(
              "text-tiny text-center transition-colors px-1 py-0.5",
              "hover:bg-accent rounded",
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