import { useState } from "react";
import { useToast } from "@/components/ui/use-toast";
import { supabase } from "@/integrations/supabase/client";

export interface InventoryFormData {
  name: string;
  partNumber: string;
  quantity: number;
  category: string;
  notes: string;
  department: string;
  subDepartment: string;
  assetType: string;
  condition: string;
  manufacturer: string;
  modelNumber: string;
  serialNumber: string;
  purchaseDate: string;
  purchasePrice: string;
  warrantyExpiration: string;
  lastMaintenanceDate: string;
  nextMaintenanceDate: string;
  building: string;
  floor: string;
  room: string;
  shelf: string;
  bin: string;
  photoUrl?: string;
}

const initialFormData: InventoryFormData = {
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
  photoUrl: "",
};

export const useInventoryForm = () => {
  const { toast } = useToast();
  const [formData, setFormData] = useState<InventoryFormData>(initialFormData);
  const [isProcessing, setIsProcessing] = useState(false);

  const handlePhotoUpload = async (file: File) => {
    try {
      setIsProcessing(true);
      const fileExt = file.name.split('.').pop();
      const filePath = `${crypto.randomUUID()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('inventory-images')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('inventory-images')
        .getPublicUrl(filePath);

      setFormData(prev => ({ ...prev, photoUrl: publicUrl }));
      
      toast({
        title: "Photo uploaded successfully",
      });
    } catch (error) {
      console.error("Error uploading photo:", error);
      toast({
        title: "Error uploading photo",
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
          photo_url: formData.photoUrl,
        }]);

      if (error) throw error;

      toast({
        title: "Item added successfully",
      });
      
      setFormData(initialFormData);
    } catch (error) {
      console.error("Error adding item:", error);
      toast({
        title: "Error adding item",
        variant: "destructive",
      });
    }
  };

  return {
    formData,
    setFormData,
    isProcessing,
    setIsProcessing,
    handleSubmit,
    handlePhotoUpload,
  };
};