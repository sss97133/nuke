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
    location: "",
    category: "",
    notes: "",
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
        .insert([{ ...formData }]);

      if (error) throw error;

      toast({
        title: "Item added successfully",
      });
      
      setFormData({
        name: "",
        partNumber: "",
        quantity: 0,
        location: "",
        category: "",
        notes: "",
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
    <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl mx-auto bg-[#F4F1DE] p-8 border border-[#283845]">
      <div className="text-center mb-6">
        <h2 className="text-2xl text-[#283845] uppercase tracking-wider">Inventory Entry Form</h2>
        <p className="text-sm text-[#9B2915]">Form ID: {Date.now()}</p>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-2">
          <Label htmlFor="name">Item Name</Label>
          <Input
            id="name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="font-mono"
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="partNumber">Part Number</Label>
          <Input
            id="partNumber"
            value={formData.partNumber}
            onChange={(e) => setFormData({ ...formData, partNumber: e.target.value })}
            className="font-mono"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="quantity">Quantity</Label>
          <Input
            id="quantity"
            type="number"
            value={formData.quantity}
            onChange={(e) => setFormData({ ...formData, quantity: parseInt(e.target.value) })}
            className="font-mono"
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="category">Category</Label>
          <Select
            value={formData.category}
            onValueChange={(value) => setFormData({ ...formData, category: value })}
          >
            <SelectTrigger className="font-mono">
              <SelectValue placeholder="Select category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="parts">Parts</SelectItem>
              <SelectItem value="tools">Tools</SelectItem>
              <SelectItem value="supplies">Supplies</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="notes">Notes</Label>
        <Textarea
          id="notes"
          value={formData.notes}
          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
          className="font-mono"
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
          className="font-mono"
        />
      </div>

      <Button
        type="submit"
        className="w-full bg-[#283845] hover:bg-[#1a2830] text-white font-mono"
        disabled={isProcessing}
      >
        {isProcessing ? "Processing..." : "Submit Entry"}
      </Button>
    </form>
  );
};

