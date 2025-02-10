
import { cn } from "@/lib/utils";

interface ProgressBarProps {
  steps: { title: string }[];
  currentStep: number;
  onStepClick: (index: number) => void;
}

export const ProgressBar = ({ steps, currentStep, onStepClick }: ProgressBarProps) => {
  return (
    <div className="mb-6">
      <div className="flex justify-between items-center relative mb-8">
        {steps.map((step, index) => {
          const isActive = index === currentStep;
          const isPast = index < currentStep;
          
          return (
            <button
              key={index}
              onClick={() => onStepClick(index)}
              className="relative flex flex-col items-center group"
            >
              {/* Step circle */}
              <div 
                className={cn(
                  "w-2 h-2 rounded-full mb-3",
                  "transition-all duration-200 ease-out",
                  isActive && "w-3 h-3 bg-primary",
                  !isActive && isPast && "bg-primary/60",
                  !isActive && !isPast && "bg-muted-foreground/30"
                )}
              />
              
              {/* Step label */}
              <span 
                className={cn(
                  "text-[11px] font-medium tracking-tight absolute -bottom-6",
                  "transition-colors duration-200",
                  isActive ? "text-primary" : "text-muted-foreground/70"
                )}
              >
                {step.title}
              </span>

              {/* Connector line */}
              {index < steps.length - 1 && (
                <div 
                  className={cn(
                    "absolute top-[5px] left-[10px] h-[1px]",
                    isPast ? "bg-primary/60" : "bg-muted-foreground/30"
                  )}
                  style={{ width: "calc(100% + 1.5rem)" }}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};
