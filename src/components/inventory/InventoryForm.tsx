import { Button } from "@/components/ui/button";
import { BasicInformation } from "./form-sections/BasicInformation";
import { Categorization } from "./form-sections/Categorization";
import { ProductDetails } from "./form-sections/ProductDetails";
import { PurchaseMaintenance } from "./form-sections/PurchaseMaintenance";
import { Location } from "./form-sections/Location";
import { AdditionalInformation } from "./form-sections/AdditionalInformation";
import { PhotoCapture } from "./form-sections/PhotoCapture";
import { useInventoryForm } from "./form-handlers/useInventoryForm";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface InventoryFormProps {
  onSuccess?: () => void;
}

const steps = [
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
    setFormData,
    isProcessing,
    setIsProcessing,
    handleSubmit: originalHandleSubmit,
    handlePhotoUpload,
  } = useInventoryForm();

  const [currentStep, setCurrentStep] = useState(0);

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

  const getStepProps = () => {
    const commonProps = {
      name: formData.name || "",
      partNumber: formData.partNumber || "",
      department: formData.department || "",
      subDepartment: formData.subDepartment || "",
      assetType: formData.assetType || "",
      condition: formData.condition || "",
      manufacturer: formData.manufacturer || "",
      modelNumber: formData.modelNumber || "",
      serialNumber: formData.serialNumber || "",
      quantity: formData.quantity || 0,
      purchaseDate: formData.purchaseDate || "",
      purchasePrice: formData.purchasePrice || "",
      warrantyExpiration: formData.warrantyExpiration || "",
      lastMaintenanceDate: formData.lastMaintenanceDate || "",
      nextMaintenanceDate: formData.nextMaintenanceDate || "",
      building: formData.building || "",
      floor: formData.floor || "",
      room: formData.room || "",
      shelf: formData.shelf || "",
      bin: formData.bin || "",
      notes: formData.notes || "",
      onNameChange: (value: string) => setFormData({ ...formData, name: value }),
      onPartNumberChange: (value: string) => setFormData({ ...formData, partNumber: value }),
      onDepartmentChange: (value: string) => setFormData({ ...formData, department: value }),
      onSubDepartmentChange: (value: string) => setFormData({ ...formData, subDepartment: value }),
      onAssetTypeChange: (value: string) => setFormData({ ...formData, assetType: value }),
      onConditionChange: (value: string) => setFormData({ ...formData, condition: value }),
      onManufacturerChange: (value: string) => setFormData({ ...formData, manufacturer: value }),
      onModelNumberChange: (value: string) => setFormData({ ...formData, modelNumber: value }),
      onSerialNumberChange: (value: string) => setFormData({ ...formData, serialNumber: value }),
      onQuantityChange: (value: number) => setFormData({ ...formData, quantity: value }),
      onPurchaseDateChange: (value: string) => setFormData({ ...formData, purchaseDate: value }),
      onPurchasePriceChange: (value: string) => setFormData({ ...formData, purchasePrice: value }),
      onWarrantyExpirationChange: (value: string) => setFormData({ ...formData, warrantyExpiration: value }),
      onLastMaintenanceDateChange: (value: string) => setFormData({ ...formData, lastMaintenanceDate: value }),
      onNextMaintenanceDateChange: (value: string) => setFormData({ ...formData, nextMaintenanceDate: value }),
      onBuildingChange: (value: string) => setFormData({ ...formData, building: value }),
      onFloorChange: (value: string) => setFormData({ ...formData, floor: value }),
      onRoomChange: (value: string) => setFormData({ ...formData, room: value }),
      onShelfChange: (value: string) => setFormData({ ...formData, shelf: value }),
      onBinChange: (value: string) => setFormData({ ...formData, bin: value }),
      onNotesChange: (value: string) => setFormData({ ...formData, notes: value }),
      onImageUpload: handlePhotoUpload,
      isProcessing,
    };

    switch (currentStep) {
      case 0:
        return {
          onPhotoCapture: handlePhotoUpload,
          onSkip: () => setCurrentStep(1),
        };
      case 1:
        return {
          name: commonProps.name,
          partNumber: commonProps.partNumber,
          onNameChange: commonProps.onNameChange,
          onPartNumberChange: commonProps.onPartNumberChange,
        };
      case 2:
        return {
          department: commonProps.department,
          subDepartment: commonProps.subDepartment,
          assetType: commonProps.assetType,
          condition: commonProps.condition,
          onDepartmentChange: commonProps.onDepartmentChange,
          onSubDepartmentChange: commonProps.onSubDepartmentChange,
          onAssetTypeChange: commonProps.onAssetTypeChange,
          onConditionChange: commonProps.onConditionChange,
        };
      case 3:
        return {
          manufacturer: commonProps.manufacturer,
          modelNumber: commonProps.modelNumber,
          serialNumber: commonProps.serialNumber,
          quantity: commonProps.quantity,
          onManufacturerChange: commonProps.onManufacturerChange,
          onModelNumberChange: commonProps.onModelNumberChange,
          onSerialNumberChange: commonProps.onSerialNumberChange,
          onQuantityChange: commonProps.onQuantityChange,
        };
      case 4:
        return {
          purchaseDate: commonProps.purchaseDate,
          purchasePrice: commonProps.purchasePrice,
          warrantyExpiration: commonProps.warrantyExpiration,
          lastMaintenanceDate: commonProps.lastMaintenanceDate,
          nextMaintenanceDate: commonProps.nextMaintenanceDate,
          onPurchaseDateChange: commonProps.onPurchaseDateChange,
          onPurchasePriceChange: commonProps.onPurchasePriceChange,
          onWarrantyExpirationChange: commonProps.onWarrantyExpirationChange,
          onLastMaintenanceDateChange: commonProps.onLastMaintenanceDateChange,
          onNextMaintenanceDateChange: commonProps.onNextMaintenanceDateChange,
        };
      case 5:
        return {
          building: commonProps.building,
          floor: commonProps.floor,
          room: commonProps.room,
          shelf: commonProps.shelf,
          bin: commonProps.bin,
          onBuildingChange: commonProps.onBuildingChange,
          onFloorChange: commonProps.onFloorChange,
          onRoomChange: commonProps.onRoomChange,
          onShelfChange: commonProps.onShelfChange,
          onBinChange: commonProps.onBinChange,
        };
      case 6:
        return {
          notes: commonProps.notes,
          onNotesChange: commonProps.onNotesChange,
          onImageUpload: commonProps.onImageUpload,
          isProcessing: commonProps.isProcessing,
        };
      default:
        return {};
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      {/* Progress Bar */}
      <div className="mb-8">
        <div className="flex justify-between mb-2">
          {steps.map((step, index) => (
            <button
              key={index}
              onClick={() => setCurrentStep(index)}
              className={cn(
                "text-sm font-mono transition-colors",
                index === currentStep
                  ? "text-foreground font-semibold"
                  : "text-muted-foreground"
              )}
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

      <form onSubmit={handleSubmit} className="space-y-6 bg-background border border-border p-6 shadow-classic">
        <div className="border-b border-border bg-muted p-4">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-sm font-mono text-foreground tracking-tight uppercase">
                {steps[currentStep].title}
              </h2>
              <p className="text-xs text-muted-foreground font-mono mt-1">
                Step {currentStep + 1} of {steps.length}
              </p>
            </div>
            <div className="text-xs text-muted-foreground font-mono">
              {new Date().toISOString().split('T')[0]}
            </div>
          </div>
        </div>

        <div className="p-6 space-y-6">
          <CurrentStepComponent {...getStepProps()} />
        </div>

        <div className="border-t border-border bg-muted p-4 flex justify-between">
          <Button
            type="button"
            variant="secondary"
            onClick={handleBack}
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
              : currentStep === steps.length - 1
              ? "Submit"
              : "Next"}
          </Button>
        </div>
      </form>
    </div>
  );
};