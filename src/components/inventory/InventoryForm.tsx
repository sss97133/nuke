import { useState } from "react";
import { useToast } from "@/components/ui/use-toast";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { pipeline } from "@huggingface/transformers";
import { supabase } from "@/integrations/supabase/client";

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
      // Process image with HuggingFace
      const classifier = await pipeline(
        "image-classification",
        "onnx-community/mobilenetv4_conv_small.e2400_r224_in1k",
        { device: "webgpu" }
      );

      const imageUrl = URL.createObjectURL(file);
      const result = await classifier(imageUrl);
      
      // Upload to Supabase Storage
      const { data, error } = await supabase.storage
        .from("inventory-images")
        .upload(`${Date.now()}-${file.name}`, file);

      if (error) throw error;

      // Safely access the classification result
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

      {/* Basic Information */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-[#283845]">Basic Information</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="name">Item Name *</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="partNumber">Part Number</Label>
            <Input
              id="partNumber"
              value={formData.partNumber}
              onChange={(e) => setFormData({ ...formData, partNumber: e.target.value })}
            />
          </div>
        </div>
      </div>

      {/* Categorization */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-[#283845]">Categorization</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="department">Department</Label>
            <Select value={formData.department} onValueChange={(value) => setFormData({ ...formData, department: value })}>
              <SelectTrigger>
                <SelectValue placeholder="Select department" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="maintenance">Maintenance</SelectItem>
                <SelectItem value="kitchen">Kitchen</SelectItem>
                <SelectItem value="office">Office</SelectItem>
                <SelectItem value="it">IT</SelectItem>
                <SelectItem value="facilities">Facilities</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="subDepartment">Sub-Department</Label>
            <Input
              id="subDepartment"
              value={formData.subDepartment}
              onChange={(e) => setFormData({ ...formData, subDepartment: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="assetType">Asset Type</Label>
            <Select value={formData.assetType} onValueChange={(value) => setFormData({ ...formData, assetType: value })}>
              <SelectTrigger>
                <SelectValue placeholder="Select asset type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tool">Tool</SelectItem>
                <SelectItem value="equipment">Equipment</SelectItem>
                <SelectItem value="furniture">Furniture</SelectItem>
                <SelectItem value="supplies">Supplies</SelectItem>
                <SelectItem value="electronics">Electronics</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="condition">Condition</Label>
            <Select value={formData.condition} onValueChange={(value) => setFormData({ ...formData, condition: value })}>
              <SelectTrigger>
                <SelectValue placeholder="Select condition" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="new">New</SelectItem>
                <SelectItem value="excellent">Excellent</SelectItem>
                <SelectItem value="good">Good</SelectItem>
                <SelectItem value="fair">Fair</SelectItem>
                <SelectItem value="poor">Poor</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Product Details */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-[#283845]">Product Details</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="manufacturer">Manufacturer</Label>
            <Input
              id="manufacturer"
              value={formData.manufacturer}
              onChange={(e) => setFormData({ ...formData, manufacturer: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="modelNumber">Model Number</Label>
            <Input
              id="modelNumber"
              value={formData.modelNumber}
              onChange={(e) => setFormData({ ...formData, modelNumber: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="serialNumber">Serial Number</Label>
            <Input
              id="serialNumber"
              value={formData.serialNumber}
              onChange={(e) => setFormData({ ...formData, serialNumber: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="quantity">Quantity *</Label>
            <Input
              id="quantity"
              type="number"
              value={formData.quantity}
              onChange={(e) => setFormData({ ...formData, quantity: parseInt(e.target.value) })}
              required
            />
          </div>
        </div>
      </div>

      {/* Purchase & Maintenance */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-[#283845]">Purchase & Maintenance</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="purchaseDate">Purchase Date</Label>
            <Input
              id="purchaseDate"
              type="date"
              value={formData.purchaseDate}
              onChange={(e) => setFormData({ ...formData, purchaseDate: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="purchasePrice">Purchase Price</Label>
            <Input
              id="purchasePrice"
              type="number"
              step="0.01"
              value={formData.purchasePrice}
              onChange={(e) => setFormData({ ...formData, purchasePrice: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="warrantyExpiration">Warranty Expiration</Label>
            <Input
              id="warrantyExpiration"
              type="date"
              value={formData.warrantyExpiration}
              onChange={(e) => setFormData({ ...formData, warrantyExpiration: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lastMaintenanceDate">Last Maintenance</Label>
            <Input
              id="lastMaintenanceDate"
              type="date"
              value={formData.lastMaintenanceDate}
              onChange={(e) => setFormData({ ...formData, lastMaintenanceDate: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="nextMaintenanceDate">Next Maintenance</Label>
            <Input
              id="nextMaintenanceDate"
              type="date"
              value={formData.nextMaintenanceDate}
              onChange={(e) => setFormData({ ...formData, nextMaintenanceDate: e.target.value })}
            />
          </div>
        </div>
      </div>

      {/* Location */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-[#283845]">Location</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="building">Building</Label>
            <Input
              id="building"
              value={formData.building}
              onChange={(e) => setFormData({ ...formData, building: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="floor">Floor</Label>
            <Input
              id="floor"
              value={formData.floor}
              onChange={(e) => setFormData({ ...formData, floor: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="room">Room</Label>
            <Input
              id="room"
              value={formData.room}
              onChange={(e) => setFormData({ ...formData, room: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="shelf">Shelf</Label>
            <Input
              id="shelf"
              value={formData.shelf}
              onChange={(e) => setFormData({ ...formData, shelf: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="bin">Bin</Label>
            <Input
              id="bin"
              value={formData.bin}
              onChange={(e) => setFormData({ ...formData, bin: e.target.value })}
            />
          </div>
        </div>
      </div>

      {/* Notes & Image Upload */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-[#283845]">Additional Information</h3>
        <div className="space-y-2">
          <Label htmlFor="notes">Notes</Label>
          <Textarea
            id="notes"
            value={formData.notes}
            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="image">Upload Image</Label>
          <Input
            id="image"
            type="file"
            accept="image/*"
            onChange={handleImageUpload}
            disabled={isProcessing}
          />
        </div>
      </div>

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
