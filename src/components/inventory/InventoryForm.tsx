import { Button } from "@/components/ui/button";
import { BasicInformation } from "./form-sections/BasicInformation";
import { Categorization } from "./form-sections/Categorization";
import { ProductDetails } from "./form-sections/ProductDetails";
import { PurchaseMaintenance } from "./form-sections/PurchaseMaintenance";
import { Location } from "./form-sections/Location";
import { AdditionalInformation } from "./form-sections/AdditionalInformation";
import { ImageProcessing } from "./form-sections/ImageProcessing";
import { useInventoryForm } from "./form-handlers/useInventoryForm";

export const InventoryForm = () => {
  const {
    formData,
    setFormData,
    isProcessing,
    setIsProcessing,
    handleSubmit,
  } = useInventoryForm();

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setIsProcessing(true);
    // Process image upload logic here if needed
    setIsProcessing(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-4xl mx-auto bg-white border border-gray-200 shadow-sm">
      <div className="border-b border-gray-200 bg-gray-50 p-4">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-sm font-mono text-[#283845] tracking-tight uppercase">Technical Asset Documentation</h2>
            <p className="text-xs text-[#666] font-mono mt-1">Reference: {Date.now()}</p>
          </div>
          <div className="text-xs text-[#666] font-mono">
            {new Date().toISOString().split('T')[0]}
          </div>
        </div>
      </div>

      <div className="p-6 space-y-6">
        <BasicInformation
          name={formData.name}
          partNumber={formData.partNumber}
          onNameChange={(value) => setFormData({ ...formData, name: value })}
          onPartNumberChange={(value) => setFormData({ ...formData, partNumber: value })}
        />

        <Categorization
          department={formData.department}
          subDepartment={formData.subDepartment}
          assetType={formData.assetType}
          condition={formData.condition}
          onDepartmentChange={(value) => setFormData({ ...formData, department: value })}
          onSubDepartmentChange={(value) => setFormData({ ...formData, subDepartment: value })}
          onAssetTypeChange={(value) => setFormData({ ...formData, assetType: value })}
          onConditionChange={(value) => setFormData({ ...formData, condition: value })}
        />

        <ProductDetails
          manufacturer={formData.manufacturer}
          modelNumber={formData.modelNumber}
          serialNumber={formData.serialNumber}
          quantity={formData.quantity}
          onManufacturerChange={(value) => setFormData({ ...formData, manufacturer: value })}
          onModelNumberChange={(value) => setFormData({ ...formData, modelNumber: value })}
          onSerialNumberChange={(value) => setFormData({ ...formData, serialNumber: value })}
          onQuantityChange={(value) => setFormData({ ...formData, quantity: value })}
        />

        <PurchaseMaintenance
          purchaseDate={formData.purchaseDate}
          purchasePrice={formData.purchasePrice}
          warrantyExpiration={formData.warrantyExpiration}
          lastMaintenanceDate={formData.lastMaintenanceDate}
          nextMaintenanceDate={formData.nextMaintenanceDate}
          onPurchaseDateChange={(value) => setFormData({ ...formData, purchaseDate: value })}
          onPurchasePriceChange={(value) => setFormData({ ...formData, purchasePrice: value })}
          onWarrantyExpirationChange={(value) => setFormData({ ...formData, warrantyExpiration: value })}
          onLastMaintenanceDateChange={(value) => setFormData({ ...formData, lastMaintenanceDate: value })}
          onNextMaintenanceDateChange={(value) => setFormData({ ...formData, nextMaintenanceDate: value })}
        />

        <Location
          building={formData.building}
          floor={formData.floor}
          room={formData.room}
          shelf={formData.shelf}
          bin={formData.bin}
          onBuildingChange={(value) => setFormData({ ...formData, building: value })}
          onFloorChange={(value) => setFormData({ ...formData, floor: value })}
          onRoomChange={(value) => setFormData({ ...formData, room: value })}
          onShelfChange={(value) => setFormData({ ...formData, shelf: value })}
          onBinChange={(value) => setFormData({ ...formData, bin: value })}
        />

        <AdditionalInformation
          notes={formData.notes}
          onNotesChange={(value) => setFormData({ ...formData, notes: value })}
          onImageUpload={handleImageUpload}
          isProcessing={isProcessing}
        />

        <ImageProcessing
          isProcessing={isProcessing}
          setIsProcessing={setIsProcessing}
        />
      </div>

      <div className="border-t border-gray-200 bg-gray-50 p-4">
        <Button
          type="submit"
          className="w-full bg-[#283845] hover:bg-[#1a2830] text-white font-mono text-sm"
          disabled={isProcessing}
        >
          {isProcessing ? "Processing Submission..." : "Submit Technical Documentation"}
        </Button>
      </div>
    </form>
  );
};