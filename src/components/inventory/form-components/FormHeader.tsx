interface FormHeaderProps {
  title: string;
  currentStep: number;
  totalSteps: number;
}

export const FormHeader = ({ title, currentStep, totalSteps }: FormHeaderProps) => {
  return (
    <div className="border-b border-border bg-muted p-4">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-sm font-mono text-foreground tracking-tight uppercase">
            {title}
          </h2>
          <p className="text-xs text-muted-foreground font-mono mt-1">
            Step {currentStep + 1} of {totalSteps}
          </p>
        </div>
        <div className="text-xs text-muted-foreground font-mono">
          {new Date().toISOString().split('T')[0]}
        </div>
      </div>
    </div>
  );
};