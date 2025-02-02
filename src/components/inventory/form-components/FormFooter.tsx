import { Button } from "@/components/ui/button";

interface FormFooterProps {
  currentStep: number;
  isProcessing: boolean;
  onBack: () => void;
  isLastStep: boolean;
}

export const FormFooter = ({ currentStep, isProcessing, onBack, isLastStep }: FormFooterProps) => {
  return (
    <div className="border-t border-border bg-muted p-4 flex justify-between">
      <Button
        type="button"
        variant="secondary"
        onClick={onBack}
        disabled={currentStep === 0}
        className="font-mono text-sm"
      >
        Back
      </Button>
      <Button
        type="submit"
        className="bg-primary hover:bg-primary/90 text-primary-foreground font-mono text-sm"
        disabled={isProcessing}
      >
        {isProcessing
          ? "Processing..."
          : isLastStep
          ? "Submit"
          : "Next"}
      </Button>
    </div>
  );
};