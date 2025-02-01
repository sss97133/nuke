import { useState } from "react";
import { useToast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import { pipeline } from "@huggingface/transformers";
import { supabase } from "@/integrations/supabase/client";
import { BasicInformation } from "./form-sections/BasicInformation";
import { Categorization } from "./form-sections/Categorization";
import { ProductDetails } from "./form-sections/ProductDetails";
import { PurchaseMaintenance } from "./form-sections/PurchaseMaintenance";
import { Location } from "./form-sections/Location";
import { AdditionalInformation } from "./form-sections/AdditionalInformation";

export const InventoryForm = () => {
  const { toast } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    partNumber: "",
    quantity: 0,
    category: "",
    notes: "",
    department: "",
    subDepartment: "",
    assetType: "",
    condition: "",
    manufacturer: "",
    modelNumber: "",
    serialNumber: "",
    purchaseDate: "",
    purchasePrice: "",
    warrantyExpiration: "",
    lastMaintenanceDate: "",
    nextMaintenanceDate: "",
    building: "",
    floor: "",
    room: "",
    shelf: "",
    bin: "",
  });

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    try {
      const classifier = await pipeline(
        "image-classification",
        "onnx-community/mobilenetv4_conv_small.e2400_r224_in1k",
        { device: "webgpu" }
      );

      const imageUrl = URL.createObjectURL(file);
      const result = await classifier(imageUrl);
      
      const { data, error } = await supabase.storage
        .from("inventory-images")
        .upload(`${Date.now()}-${file.name}`, file);

      if (error) throw error;

      const detectedLabel = Array.isArray(result) && result.length > 0 
        ? (result[0] as { label?: string, score?: number }).label || 'Unknown'
        : 'Unknown';

      toast({
        title: "Image processed successfully",
        description: `Detected: ${detectedLabel}`,
      });
    } catch (error) {
      console.error("Error processing image:", error);
      toast({
        title: "Error processing image",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const { data, error } = await supabase
        .from("inventory")
        .insert([{
          name: formData.name,
          part_number: formData.partNumber,
          quantity: formData.quantity,
          category: formData.category,
          notes: formData.notes,
          department: formData.department,
          sub_department: formData.subDepartment,
          asset_type: formData.assetType,
          condition: formData.condition,
          manufacturer: formData.manufacturer,
          model_number: formData.modelNumber,
          serial_number: formData.serialNumber,
          purchase_date: formData.purchaseDate || null,
          purchase_price: formData.purchasePrice ? parseFloat(formData.purchasePrice) : null,
          warranty_expiration: formData.warrantyExpiration || null,
          last_maintenance_date: formData.lastMaintenanceDate || null,
          next_maintenance_date: formData.nextMaintenanceDate || null,
          building: formData.building,
          floor: formData.floor,
          room: formData.room,
          shelf: formData.shelf,
          bin: formData.bin,
        }]);

      if (error) throw error;

      toast({
        title: "Item added successfully",
      });
      
      setFormData({
        name: "",
        partNumber: "",
        quantity: 0,
        category: "",
        notes: "",
        department: "",
        subDepartment: "",
        assetType: "",
        condition: "",
        manufacturer: "",
        modelNumber: "",
        serialNumber: "",
        purchaseDate: "",
        purchasePrice: "",
        warrantyExpiration: "",
        lastMaintenanceDate: "",
        nextMaintenanceDate: "",
        building: "",
        floor: "",
        room: "",
        shelf: "",
        bin: "",
      });
    } catch (error) {
      console.error("Error adding item:", error);
      toast({
        title: "Error adding item",
        variant: "destructive",
      });
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-8 max-w-4xl mx-auto bg-[#F4F1DE] p-8 border border-[#283845]">
      <div className="text-center mb-6">
        <h2 className="text-2xl text-[#283845] uppercase tracking-wider">Inventory Entry Form</h2>
        <p className="text-sm text-[#9B2915]">Form ID: {Date.now()}</p>
      </div>

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

      <Button
        type="submit"
        className="w-full bg-[#283845] hover:bg-[#1a2830] text-white"
        disabled={isProcessing}
      >
        {isProcessing ? "Processing..." : "Submit Entry"}
      </Button>
    </form>
  );
};