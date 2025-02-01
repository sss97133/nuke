import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { VinCapture } from "./VinCapture";
import { supabase } from "@/integrations/supabase/client";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

export const VehicleForm = () => {
  const { toast } = useToast();
  const [formData, setFormData] = useState({
    make: "",
    model: "",
    year: new Date().getFullYear(),
    vin: "",
    notes: "",
  });
  const [vinDetails, setVinDetails] = useState<any>(null);

  const handleVinData = (data: any) => {
    console.log("Received VIN data:", data);
    if (data.data) {
      setVinDetails(data.data);
      setFormData(prev => ({
        ...prev,
        make: data.data.basic.make || "",
        model: data.data.basic.model || "",
        year: parseInt(data.data.basic.year) || new Date().getFullYear(),
        vin: data.vin || "",
        notes: `Manufacturer: ${data.data.basic.manufacturer || 'N/A'}\nEngine: ${data.data.specifications.engineType || 'N/A'}\nTransmission: ${data.data.specifications.transmissionStyle || 'N/A'}`
      }));

      toast({
        title: "VIN Details Retrieved",
        description: "Vehicle information has been automatically filled.",
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const { error } = await supabase.from("vehicles").insert([{
        ...formData,
        vin_verification_data: vinDetails
      }]);

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
      setVinDetails(null);
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

      {vinDetails && (
        <Accordion type="single" collapsible className="w-full">
          <AccordionItem value="manufacturing">
            <AccordionTrigger className="text-sm font-mono">
              Manufacturing Details
            </AccordionTrigger>
            <AccordionContent>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="font-semibold">Plant Country:</span> {vinDetails.manufacturing.plantCountry}
                </div>
                <div>
                  <span className="font-semibold">Plant Location:</span> {vinDetails.manufacturing.plantCity}, {vinDetails.manufacturing.plantState}
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="specifications">
            <AccordionTrigger className="text-sm font-mono">
              Technical Specifications
            </AccordionTrigger>
            <AccordionContent>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="font-semibold">Engine:</span> {vinDetails.specifications.engineType}
                </div>
                <div>
                  <span className="font-semibold">Transmission:</span> {vinDetails.specifications.transmissionStyle}
                </div>
                <div>
                  <span className="font-semibold">Drive Type:</span> {vinDetails.specifications.driveType}
                </div>
                <div>
                  <span className="font-semibold">Engine HP:</span> {vinDetails.specifications.engineHP}
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="characteristics">
            <AccordionTrigger className="text-sm font-mono">
              Vehicle Characteristics
            </AccordionTrigger>
            <AccordionContent>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="font-semibold">Body Class:</span> {vinDetails.characteristics.bodyClass}
                </div>
                <div>
                  <span className="font-semibold">Doors:</span> {vinDetails.characteristics.doors}
                </div>
                <div>
                  <span className="font-semibold">Series:</span> {vinDetails.characteristics.series}
                </div>
                <div>
                  <span className="font-semibold">Trim:</span> {vinDetails.characteristics.trim}
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="safety">
            <AccordionTrigger className="text-sm font-mono">
              Safety Features
            </AccordionTrigger>
            <AccordionContent>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="font-semibold">Safety Rating:</span> {vinDetails.safety.safetyRating}
                </div>
                <div>
                  <span className="font-semibold">Airbag Locations:</span> {vinDetails.safety.airBagLocations}
                </div>
                <div>
                  <span className="font-semibold">ABS:</span> {vinDetails.safety.antiLockBrakingSystem}
                </div>
                <div>
                  <span className="font-semibold">Traction Control:</span> {vinDetails.safety.tractionControlType}
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}

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