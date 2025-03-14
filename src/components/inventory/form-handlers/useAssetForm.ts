
import type { Database } from '../types';
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import type { Asset } from "@/types/inventory";

const initialFormData: Asset = {
  id: "",
  name: "",
  partNumber: "",
  quantity: 0,
  createdBy: "",
  updatedBy: "",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

export const useAssetForm = () => {
  const { toast } = useToast();
  const [formData, setFormData] = useState<Asset>(initialFormData);
  const [isProcessing, setIsProcessing] = useState(false);

  const handlePhotoUpload = async (file: File) => {
    try {
      setIsProcessing(true);
      const fileExt = file.name.split('.').pop();
      const filePath = `${crypto.randomUUID()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
  if (error) console.error("Database query error:", error);
        .from('asset-images')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('asset-images')
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
    
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (error) console.error("Database query error:", error);
    
    if (sessionError || !session) {
      toast({
        title: "Error",
        description: "You must be logged in to add assets",
        variant: "destructive",
      });
      return;
    }

    try {
      const { data, error } = await supabase
  if (error) console.error("Database query error:", error);
        .from("assets")
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
          ai_classification: formData.aiClassification || null,
          user_id: session.user.id,
        }]);

      if (error) throw error;

      toast({
        title: "Asset added successfully",
      });
      
      setFormData(initialFormData);
    } catch (error) {
      console.error("Error adding asset:", error);
      toast({
        title: "Error adding asset",
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
