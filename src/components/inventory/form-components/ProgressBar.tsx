
import { cn } from "@/lib/utils";

interface ProgressBarProps {
  steps: { title: string }[];
  currentStep: number;
  onStepClick: (index: number) => void;
}

export const ProgressBar = ({ steps, currentStep, onStepClick }: ProgressBarProps) => {
  return (
    <div className="mb-8">
      <div className="flex justify-between items-center mb-4">
        {steps.map((step, index) => {
          const isActive = index === currentStep;
          const isPast = index < currentStep;
          
          return (
            <button
              key={index}
              onClick={() => onStepClick(index)}
              className={cn(
                "relative flex flex-col items-center group",
                "transition-colors duration-200 ease-in-out"
              )}
            >
              {/* Step circle */}
              <div 
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center mb-2",
                  "border-2 transition-colors duration-200",
                  isActive && "border-primary bg-primary text-primary-foreground",
                  !isActive && isPast && "border-muted-foreground bg-muted-foreground text-primary-foreground",
                  !isActive && !isPast && "border-muted bg-background text-muted-foreground"
                )}
              >
                {index + 1}
              </div>
              
              {/* Step label */}
              <span 
                className={cn(
                  "absolute -bottom-6 text-xs tracking-wide whitespace-nowrap",
                  "opacity-0 group-hover:opacity-100 transition-opacity duration-200",
                  isActive ? "text-primary" : "text-muted-foreground"
                )}
              >
                {step.title}
              </span>

              {/* Connector line */}
              {index < steps.length - 1 && (
                <div 
                  className={cn(
                    "absolute top-4 left-full w-full h-0.5 -translate-y-1/2",
                    isPast ? "bg-muted-foreground" : "bg-muted"
                  )}
                  style={{ width: "calc(100% - 2rem)" }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-primary transition-all duration-300 ease-in-out"
          style={{
            width: `${((currentStep + 1) / steps.length) * 100}%`,
          }}
        />
      </div>
    </div>
  );
};
