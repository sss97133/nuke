import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { VehicleSelection } from "./form-sections/VehicleSelection";
import { ServiceDetails } from "./form-sections/ServiceDetails";
import { ServiceParts } from "./form-sections/ServiceParts";
import { VehicleForm } from "../vehicles/VehicleForm";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import type { Vehicle } from "@/types/inventory";

interface Part {
  name: string;
  quantity: number;
}

const steps = [
  { id: "vehicle", title: "Select Vehicle" },
  { id: "details", title: "Service Details" },
  { id: "parts", title: "Parts Required" },
];

export const ServiceTicketForm = () => {
  const [currentStep, setCurrentStep] = useState(0);
  const [showNewVehicle, setShowNewVehicle] = useState(false);
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);
  const [description, setDescription] = useState("");
  const [serviceType, setServiceType] = useState("");
  const [parts, setParts] = useState<Part[]>([]);
  const { toast } = useToast();

  const handleSubmit = async () => {
    if (!selectedVehicle) {
      toast({
        title: "Error",
        description: "Please select a vehicle",
        variant: "destructive",
      });
      return;
    }

    try {
      const { error } = await supabase.from("service_tickets").insert({
        vehicle_id: selectedVehicle.id,
        description,
        service_type: serviceType,
        parts_used: parts,
        status: "pending",
        priority: "medium", // This would be based on vehicle priority in a real implementation
        user_id: (await supabase.auth.getUser()).data.user?.id
      });

      if (error) throw error;

      toast({
        title: "Success",
        description: "Service ticket created successfully",
      });

      // Reset form
      setSelectedVehicle(null);
      setDescription("");
      setServiceType("");
      setParts([]);
      setCurrentStep(0);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      handleSubmit();
    }
  };

  const handleBack = () => {
    setCurrentStep(Math.max(0, currentStep - 1));
  };

  const renderStep = () => {
    switch (currentStep) {
      case 0:
        return (
          <VehicleSelection
            onVehicleSelect={setSelectedVehicle}
            onShowNewVehicle={() => setShowNewVehicle(true)}
          />
        );
      case 1:
        return (
          <ServiceDetails
            description={description}
            serviceType={serviceType}
            onDescriptionChange={setDescription}
            onServiceTypeChange={setServiceType}
          />
        );
      case 2:
        return <ServiceParts parts={parts} onPartsChange={setParts} />;
      default:
        return null;
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-8">
        <div className="flex justify-between items-center mb-4">
          {steps.map((step, index) => (
            <div
              key={step.id}
              className={`flex-1 text-center ${
                index === currentStep
                  ? "text-primary font-semibold"
                  : "text-muted-foreground"
              }`}
            >
              {step.title}
            </div>
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

      <div className="bg-card border rounded-lg p-6 shadow-sm">
        <form onSubmit={(e) => e.preventDefault()} className="space-y-6">
          {renderStep()}

          <div className="flex justify-between pt-6 border-t">
            <Button
              type="button"
              variant="outline"
              onClick={handleBack}
              disabled={currentStep === 0}
            >
              Back
            </Button>
            <Button onClick={handleNext}>
              {currentStep === steps.length - 1 ? "Submit" : "Next"}
            </Button>
          </div>
        </form>
      </div>

      <Dialog open={showNewVehicle} onOpenChange={setShowNewVehicle}>
        <DialogContent className="max-w-2xl">
          <VehicleForm onSuccess={() => setShowNewVehicle(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
};