import { useState } from "react";
import { InventoryFormData } from "./useInventoryForm";

export const useFormSteps = (steps: { title: string }[], formData: InventoryFormData) => {
  const [currentStep, setCurrentStep] = useState(0);

  const getStepProps = (handlePhotoUpload: (file: File) => Promise<void>, isProcessing: boolean, setFormData: (data: InventoryFormData) => void) => {
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

  return {
    currentStep,
    setCurrentStep,
    getStepProps,
  };
};