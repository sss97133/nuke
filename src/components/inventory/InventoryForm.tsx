import { Button } from "@/components/ui/button";
import { BasicInformation } from "./form-sections/BasicInformation";
import { Categorization } from "./form-sections/Categorization";
import { ProductDetails } from "./form-sections/ProductDetails";
import { PurchaseMaintenance } from "./form-sections/PurchaseMaintenance";
import { Location } from "./form-sections/Location";
import { AdditionalInformation } from "./form-sections/AdditionalInformation";
import { PhotoCapture } from "./form-sections/PhotoCapture";
import { useInventoryForm } from "./form-handlers/useInventoryForm";
import { useFormSteps } from "./form-handlers/useFormSteps";
import { ProgressBar } from "./form-components/ProgressBar";
import { FormHeader } from "./form-components/FormHeader";
import { FormFooter } from "./form-components/FormFooter";
import type { InventoryFormData } from "./form-handlers/useInventoryForm";

interface InventoryFormProps {
  onSuccess?: () => void;
}

type StepComponent = {
  title: string;
  component: React.ComponentType<any>;
};

const steps: StepComponent[] = [
  { title: "Photo", component: PhotoCapture },
  { title: "Basic Information", component: BasicInformation },
  { title: "Categorization", component: Categorization },
  { title: "Product Details", component: ProductDetails },
  { title: "Purchase & Maintenance", component: PurchaseMaintenance },
  { title: "Location", component: Location },
  { title: "Additional Information", component: AdditionalInformation },
];

export const InventoryForm = ({ onSuccess }: InventoryFormProps = {}) => {
  const {
    formData,
    setFormData: originalSetFormData,
    isProcessing,
    handleSubmit: originalHandleSubmit,
    handlePhotoUpload,
  } = useInventoryForm();

  const setFormData = (data: Partial<InventoryFormData>) => {
    originalSetFormData(prev => ({ ...prev, ...data }));
  };

  const { currentStep, setCurrentStep, getStepProps } = useFormSteps(steps, formData);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      await originalHandleSubmit(e);
      onSuccess?.();
    }
  };

  const handleBack = () => {
    setCurrentStep(Math.max(0, currentStep - 1));
  };

  const CurrentStepComponent = steps[currentStep].component;
  const stepProps = getStepProps(handlePhotoUpload, isProcessing, setFormData);

  return (
    <div className="max-w-4xl mx-auto">
      <ProgressBar
        steps={steps}
        currentStep={currentStep}
        onStepClick={setCurrentStep}
      />

      <form onSubmit={handleSubmit} className="space-y-6 bg-background border border-border p-6 shadow-classic">
        <FormHeader
          title={steps[currentStep].title}
          currentStep={currentStep}
          totalSteps={steps.length}
        />

        <div className="p-6 space-y-6">
          <CurrentStepComponent {...stepProps} />
        </div>

        <FormFooter
          currentStep={currentStep}
          isProcessing={isProcessing}
          onBack={handleBack}
          isLastStep={currentStep === steps.length - 1}
        />
      </form>
    </div>
  );
};