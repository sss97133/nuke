import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { VinCapture } from "./VinCapture";
import { supabase } from "@/integrations/supabase/client";

export const VehicleForm = () => {
  const { toast } = useToast();
  const [formData, setFormData] = useState({
    make: "",
    model: "",
    year: new Date().getFullYear(),
    vin: "",
    notes: "",
  });

  const handleVinData = (data: any) => {
    const vehicleData = data.data.reduce((acc: any, item: any) => {
      if (item.Variable === "Make") acc.make = item.Value;
      if (item.Variable === "Model") acc.model = item.Value;
      if (item.Variable === "Model Year") acc.year = parseInt(item.Value);
      if (item.Variable === "VIN") acc.vin = item.Value;
      return acc;
    }, {});

    setFormData(prev => ({
      ...prev,
      ...vehicleData
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const { error } = await supabase.from("vehicles").insert([formData]);

      if (error) throw error;

      toast({
        title: "Vehicle registered successfully",
      });

      setFormData({
        make: "",
        model: "",
        year: new Date().getFullYear(),
        vin: "",
        notes: "",
      });
    } catch (error) {
      console.error("Error registering vehicle:", error);
      toast({
        title: "Error registering vehicle",
        variant: "destructive",
      });
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 bg-white border border-gray-200 p-6">
      <VinCapture onVinData={handleVinData} />
      
      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-2">
          <Label htmlFor="make" className="font-mono text-sm">Make *</Label>
          <Input
            id="make"
            value={formData.make}
            onChange={(e) => setFormData({ ...formData, make: e.target.value })}
            className="font-mono"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="model" className="font-mono text-sm">Model *</Label>
          <Input
            id="model"
            value={formData.model}
            onChange={(e) => setFormData({ ...formData, model: e.target.value })}
            className="font-mono"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="year" className="font-mono text-sm">Year *</Label>
          <Input
            id="year"
            type="number"
            value={formData.year}
            onChange={(e) => setFormData({ ...formData, year: parseInt(e.target.value) })}
            className="font-mono"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="vin" className="font-mono text-sm">VIN</Label>
          <Input
            id="vin"
            value={formData.vin}
            onChange={(e) => setFormData({ ...formData, vin: e.target.value })}
            className="font-mono"
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="notes" className="font-mono text-sm">Notes</Label>
        <Textarea
          id="notes"
          value={formData.notes}
          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
          className="font-mono"
        />
      </div>
      <Button
        type="submit"
        className="w-full bg-[#283845] hover:bg-[#1a2830] text-white font-mono text-sm"
      >
        Register Vehicle
      </Button>
    </form>
  );
};