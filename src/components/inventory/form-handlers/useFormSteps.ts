import { useState } from "react";
import { InventoryFormData } from "./useInventoryForm";

interface StepProps {
  title: string;
  component: React.ComponentType<any>;
}

export const useFormSteps = (steps: StepProps[], formData: InventoryFormData) => {
  const [currentStep, setCurrentStep] = useState(0);

  const getStepProps = (
    handlePhotoUpload: (file: File) => Promise<void>,
    isProcessing: boolean,
    setFormData: (data: InventoryFormData) => void
  ) => {
    // Common props shared across all components
    const commonProps = {
      isProcessing,
    };

    // Step-specific props
    switch (currentStep) {
      case 0: // PhotoCapture
        return {
          ...commonProps,
          onPhotoCapture: handlePhotoUpload,
          onSkip: () => setCurrentStep(1),
        };
      case 1: // BasicInformation
        return {
          ...commonProps,
          name: formData.name || "",
          partNumber: formData.partNumber || "",
          onNameChange: (value: string) => setFormData({ ...formData, name: value }),
          onPartNumberChange: (value: string) => setFormData({ ...formData, partNumber: value }),
        };
      case 2: // Categorization
        return {
          ...commonProps,
          department: formData.department || "",
          subDepartment: formData.subDepartment || "",
          assetType: formData.assetType || "",
          condition: formData.condition || "",
          onDepartmentChange: (value: string) => setFormData({ ...formData, department: value }),
          onSubDepartmentChange: (value: string) => setFormData({ ...formData, subDepartment: value }),
          onAssetTypeChange: (value: string) => setFormData({ ...formData, assetType: value }),
          onConditionChange: (value: string) => setFormData({ ...formData, condition: value }),
        };
      case 3: // ProductDetails
        return {
          ...commonProps,
          manufacturer: formData.manufacturer || "",
          modelNumber: formData.modelNumber || "",
          serialNumber: formData.serialNumber || "",
          quantity: formData.quantity || 0,
          onManufacturerChange: (value: string) => setFormData({ ...formData, manufacturer: value }),
          onModelNumberChange: (value: string) => setFormData({ ...formData, modelNumber: value }),
          onSerialNumberChange: (value: string) => setFormData({ ...formData, serialNumber: value }),
          onQuantityChange: (value: number) => setFormData({ ...formData, quantity: value }),
        };
      case 4: // PurchaseMaintenance
        return {
          ...commonProps,
          purchaseDate: formData.purchaseDate || "",
          purchasePrice: formData.purchasePrice || "",
          warrantyExpiration: formData.warrantyExpiration || "",
          lastMaintenanceDate: formData.lastMaintenanceDate || "",
          nextMaintenanceDate: formData.nextMaintenanceDate || "",
          onPurchaseDateChange: (value: string) => setFormData({ ...formData, purchaseDate: value }),
          onPurchasePriceChange: (value: string) => setFormData({ ...formData, purchasePrice: value }),
          onWarrantyExpirationChange: (value: string) => setFormData({ ...formData, warrantyExpiration: value }),
          onLastMaintenanceDateChange: (value: string) => setFormData({ ...formData, lastMaintenanceDate: value }),
          onNextMaintenanceDateChange: (value: string) => setFormData({ ...formData, nextMaintenanceDate: value }),
        };
      case 5: // Location
        return {
          ...commonProps,
          building: formData.building || "",
          floor: formData.floor || "",
          room: formData.room || "",
          shelf: formData.shelf || "",
          bin: formData.bin || "",
          onBuildingChange: (value: string) => setFormData({ ...formData, building: value }),
          onFloorChange: (value: string) => setFormData({ ...formData, floor: value }),
          onRoomChange: (value: string) => setFormData({ ...formData, room: value }),
          onShelfChange: (value: string) => setFormData({ ...formData, shelf: value }),
          onBinChange: (value: string) => setFormData({ ...formData, bin: value }),
        };
      case 6: // AdditionalInformation
        return {
          ...commonProps,
          notes: formData.notes || "",
          onNotesChange: (value: string) => setFormData({ ...formData, notes: value }),
          onImageUpload: handlePhotoUpload,
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