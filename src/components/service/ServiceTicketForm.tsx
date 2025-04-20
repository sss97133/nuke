import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { getSupabaseClient } from "@/integrations/supabase/client";
import { VehicleSelection } from "./form-sections/VehicleSelection";
import { ServiceDetails } from "./form-sections/ServiceDetails";
import { ServiceParts } from "./form-sections/ServiceParts";
import { VehicleForm } from "../vehicles/VehicleForm";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import type { Vehicle } from "@/types/inventory";
import type { Database } from "@/integrations/supabase/types";

interface Part {
  name: string;
  quantity: number;
}

const steps = [
  { id: "vehicle", title: "Select Vehicle" },
  { id: "details", title: "Service Details" },
  { id: "parts", title: "Parts Required" },
];

interface ServiceTicketFormProps {
  onComplete?: () => void;
  onCancel?: () => void;
}

export const ServiceTicketForm = ({ onComplete, onCancel }: ServiceTicketFormProps) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [showNewVehicle, setShowNewVehicle] = useState(false);
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);
  const [description, setDescription] = useState("");
  const [serviceType, setServiceType] = useState("");
  const [selectedDepartment, setSelectedDepartment] = useState("");
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
      const supabase = getSupabaseClient();
      if (!supabase) {
        throw new Error('Database connection unavailable');
      }
      
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!user?.id) throw new Error('User not authenticated');
      
      const serviceTicket: Database['public']['Tables']['service_tickets']['Insert'] = {
        vehicle_id: selectedVehicle.id,
        description,
        service_type: serviceType as Database['public']['Enums']['service_type'],
        parts_used: parts as unknown as Database['public']['Tables']['service_tickets']['Insert']['parts_used'],
        status: 'pending',
        priority: 'medium',
        user_id: user.id
      };

      const { error: dbError } = await supabase
        .from('service_tickets')
        .insert(serviceTicket);

      if (dbError) throw dbError;

      toast({
        title: "Success",
        description: "Service ticket created successfully",
      });

      // Reset form
      setSelectedVehicle(null);
      setDescription("");
      setServiceType("");
      setSelectedDepartment("");
      setParts([]);
      setCurrentStep(0);
      
      // Call onComplete callback if provided
      if (onComplete) onComplete();
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to create service ticket');
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
            onDepartmentChange={setSelectedDepartment}
            selectedDepartment={selectedDepartment}
          />
        );
      case 1:
        return (
          <ServiceDetails
            description={description}
            serviceType={serviceType}
            selectedDepartment={selectedDepartment}
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
    <div className="space-y-4">
      {showNewVehicle ? (
        <div className="space-y-4">
          <VehicleForm
            onCancel={() => setShowNewVehicle(false)}
            onSave={(vehicle) => {
              setSelectedVehicle(vehicle);
              setShowNewVehicle(false);
            }}
          />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="space-y-1">
            <h2 className="text-lg font-medium">{steps[currentStep].title}</h2>
            <p className="text-sm text-muted-foreground">Step {currentStep + 1} of {steps.length}</p>
          </div>

          {renderStep()}

          <div className="flex justify-between pt-4">
            {currentStep === 0 && onCancel ? (
              <Button variant="outline" onClick={onCancel}>Cancel</Button>
            ) : (
              <Button
                variant="outline"
                onClick={handleBack}
                disabled={currentStep === 0}
              >
                Back
              </Button>
            )}
            <Button onClick={handleNext}>
              {currentStep === steps.length - 1 ? "Submit" : "Next"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};