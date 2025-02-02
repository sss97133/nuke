import { useState } from "react";
import { InventoryFormData } from "./useInventoryForm";

interface StepComponent {
  title: string;
  component: React.ComponentType<any>;
}

export const useFormSteps = (steps: StepComponent[], formData: InventoryFormData) => {
  const [currentStep, setCurrentStep] = useState(0);

  const getStepProps = (
    handlePhotoUpload: (file: File) => Promise<void>,
    isProcessing: boolean,
    setFormData: (data: Partial<InventoryFormData>) => void
  ) => {
    const commonProps = {
      isProcessing,
    };

    switch (currentStep) {
      case 0: // PhotoCapture
        return {
          ...commonProps,
          onPhotoCapture: handlePhotoUpload,
          onSkip: () => setCurrentStep(currentStep + 1),
        };
      case 1: // BasicInformation
        return {
          ...commonProps,
          name: formData.name,
          partNumber: formData.partNumber,
          onNameChange: (value: string) => setFormData({ name: value }),
          onPartNumberChange: (value: string) => setFormData({ partNumber: value }),
        };
      case 2: // Categorization
        return {
          ...commonProps,
          department: formData.department,
          subDepartment: formData.subDepartment,
          assetType: formData.assetType,
          condition: formData.condition,
          onDepartmentChange: (value: string) => setFormData({ department: value }),
          onSubDepartmentChange: (value: string) => setFormData({ subDepartment: value }),
          onAssetTypeChange: (value: string) => setFormData({ assetType: value }),
          onConditionChange: (value: string) => setFormData({ condition: value }),
        };
      case 3: // ProductDetails
        return {
          ...commonProps,
          manufacturer: formData.manufacturer,
          modelNumber: formData.modelNumber,
          serialNumber: formData.serialNumber,
          quantity: formData.quantity,
          onManufacturerChange: (value: string) => setFormData({ manufacturer: value }),
          onModelNumberChange: (value: string) => setFormData({ modelNumber: value }),
          onSerialNumberChange: (value: string) => setFormData({ serialNumber: value }),
          onQuantityChange: (value: number) => setFormData({ quantity: value }),
        };
      case 4: // PurchaseMaintenance
        return {
          ...commonProps,
          purchaseDate: formData.purchaseDate,
          purchasePrice: formData.purchasePrice,
          warrantyExpiration: formData.warrantyExpiration,
          lastMaintenanceDate: formData.lastMaintenanceDate,
          nextMaintenanceDate: formData.nextMaintenanceDate,
          onPurchaseDateChange: (value: string) => setFormData({ purchaseDate: value }),
          onPurchasePriceChange: (value: string) => setFormData({ purchasePrice: value }),
          onWarrantyExpirationChange: (value: string) => setFormData({ warrantyExpiration: value }),
          onLastMaintenanceDateChange: (value: string) => setFormData({ lastMaintenanceDate: value }),
          onNextMaintenanceDateChange: (value: string) => setFormData({ nextMaintenanceDate: value }),
        };
      case 5: // Location
        return {
          ...commonProps,
          building: formData.building,
          floor: formData.floor,
          room: formData.room,
          shelf: formData.shelf,
          bin: formData.bin,
          onBuildingChange: (value: string) => setFormData({ building: value }),
          onFloorChange: (value: string) => setFormData({ floor: value }),
          onRoomChange: (value: string) => setFormData({ room: value }),
          onShelfChange: (value: string) => setFormData({ shelf: value }),
          onBinChange: (value: string) => setFormData({ bin: value }),
        };
      case 6: // AdditionalInformation
        return {
          ...commonProps,
          notes: formData.notes,
          category: formData.category,
          onNotesChange: (value: string) => setFormData({ notes: value }),
          onCategoryChange: (value: string) => setFormData({ category: value }),
        };
      default:
        return commonProps;
    }
  };

  return {
    currentStep,
    setCurrentStep,
    getStepProps,
  };
};