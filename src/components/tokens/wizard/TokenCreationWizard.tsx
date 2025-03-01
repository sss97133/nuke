
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { NewToken } from "@/types/token";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import BasicInfoStep from "./steps/BasicInfoStep";
import SupplyStep from "./steps/SupplyStep";
import DetailsStep from "./steps/DetailsStep";
import ReviewStep from "./steps/ReviewStep";

interface TokenCreationWizardProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateToken: (token: NewToken) => Promise<void>;
}

const steps = [
  { id: "basic-info", label: "Basic Info" },
  { id: "supply", label: "Supply" },
  { id: "details", label: "Details" },
  { id: "review", label: "Review" },
];

export const TokenCreationWizard = ({
  isOpen,
  onOpenChange,
  onCreateToken,
}: TokenCreationWizardProps) => {
  const [currentStep, setCurrentStep] = useState("basic-info");
  const [newToken, setNewToken] = useState<NewToken>({
    name: "",
    symbol: "",
    total_supply: 0,
    decimals: 18,
    description: "",
    status: "active",
  });
  
  const handleNext = () => {
    const currentIndex = steps.findIndex(step => step.id === currentStep);
    if (currentIndex < steps.length - 1) {
      setCurrentStep(steps[currentIndex + 1].id);
    }
  };
  
  const handleBack = () => {
    const currentIndex = steps.findIndex(step => step.id === currentStep);
    if (currentIndex > 0) {
      setCurrentStep(steps[currentIndex - 1].id);
    }
  };
  
  const handleComplete = async () => {
    await onCreateToken(newToken);
    resetForm();
    onOpenChange(false);
  };
  
  const resetForm = () => {
    setNewToken({
      name: "",
      symbol: "",
      total_supply: 0,
      decimals: 18,
      description: "",
      status: "active",
    });
    setCurrentStep("basic-info");
  };

  const updateTokenField = (field: keyof NewToken, value: any) => {
    setNewToken(prev => ({ ...prev, [field]: value }));
  };
  
  const handleDialogClose = (open: boolean) => {
    if (!open) resetForm();
    onOpenChange(open);
  };
  
  const currentStepIndex = steps.findIndex(step => step.id === currentStep);
  const isFirstStep = currentStepIndex === 0;
  const isLastStep = currentStepIndex === steps.length - 1;

  return (
    <Dialog open={isOpen} onOpenChange={handleDialogClose}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Create New Token</DialogTitle>
          <DialogDescription>
            Complete the following steps to create your token
          </DialogDescription>
        </DialogHeader>
        
        {/* Progress indicators */}
        <div className="mb-4">
          <Tabs value={currentStep} className="w-full">
            <TabsList className="grid grid-cols-4 w-full">
              {steps.map((step, index) => {
                const isCompleted = currentStepIndex > index;
                const isCurrent = currentStep === step.id;
                
                return (
                  <TabsTrigger
                    key={step.id}
                    value={step.id}
                    className={`flex items-center justify-center ${isCompleted ? 'text-green-500' : ''}`}
                    disabled
                  >
                    {isCompleted ? (
                      <Check className="h-4 w-4 mr-1" />
                    ) : (
                      <span className="h-5 w-5 rounded-full inline-flex items-center justify-center border mr-1">
                        {index + 1}
                      </span>
                    )}
                    <span className="hidden sm:inline">{step.label}</span>
                  </TabsTrigger>
                );
              })}
            </TabsList>
            
            <TabsContent value="basic-info">
              <BasicInfoStep
                name={newToken.name}
                symbol={newToken.symbol}
                onNameChange={(value) => updateTokenField('name', value)}
                onSymbolChange={(value) => updateTokenField('symbol', value)}
              />
            </TabsContent>
            
            <TabsContent value="supply">
              <SupplyStep
                totalSupply={newToken.total_supply}
                decimals={newToken.decimals}
                onTotalSupplyChange={(value) => updateTokenField('total_supply', value)}
                onDecimalsChange={(value) => updateTokenField('decimals', value)}
              />
            </TabsContent>
            
            <TabsContent value="details">
              <DetailsStep
                description={newToken.description}
                status={newToken.status}
                onDescriptionChange={(value) => updateTokenField('description', value)}
                onStatusChange={(value) => updateTokenField('status', value)}
              />
            </TabsContent>
            
            <TabsContent value="review">
              <ReviewStep token={newToken} />
            </TabsContent>
          </Tabs>
        </div>
        
        {/* Navigation buttons */}
        <div className="flex justify-between mt-4">
          <Button
            variant="outline"
            onClick={handleBack}
            disabled={isFirstStep}
          >
            <ChevronLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          
          {isLastStep ? (
            <Button onClick={handleComplete}>
              Create Token <Check className="h-4 w-4 ml-1" />
            </Button>
          ) : (
            <Button onClick={handleNext}>
              Next <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default TokenCreationWizard;
