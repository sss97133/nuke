import type { Database } from '../types';
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { addDays } from "date-fns";

export const CreateAuction = () => {
  const { toast } = useToast();
  const [formData, setFormData] = useState({
    vehicleId: "",
    startingPrice: "",
    reservePrice: "",
    duration: "7" // Default 7 days
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const startTime = new Date();
    const endTime = addDays(startTime, parseInt(formData.duration));

    const { error } = await supabase
        .from('auctions')
      .insert([{
        vehicle_id: formData.vehicleId,
        seller_id: (await supabase.auth.getUser()).data.user?.id,
        starting_price: parseFloat(formData.startingPrice),
        reserve_price: formData.reservePrice ? parseFloat(formData.reservePrice) : null,
        start_time: startTime.toISOString(),
        end_time: endTime.toISOString(),
        status: 'active'
      }]);

    if (error) {
      toast({
        title: "Error creating auction",
        description: error.message,
        variant: "destructive"
      });
      return;
    }

    toast({
      title: "Auction created successfully",
      description: "Your vehicle is now listed for auction."
    });

    setFormData({
      vehicleId: "",
      startingPrice: "",
      reservePrice: "",
      duration: "7"
    });
  };

  return (
    <Card className="p-6">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label htmlFor="vehicleId">Vehicle ID</Label>
          <Input
            id="vehicleId"
            value={formData.vehicleId}
            onChange={(e) => setFormData({ ...formData, vehicleId: e.target.value })}
            required
          />
        </div>
        
        <div>
          <Label htmlFor="startingPrice">Starting Price ($)</Label>
          <Input
            id="startingPrice"
            type="number"
            min="0"
            step="0.01"
            value={formData.startingPrice}
            onChange={(e) => setFormData({ ...formData, startingPrice: e.target.value })}
            required
          />
        </div>

        <div>
          <Label htmlFor="reservePrice">Reserve Price ($) (Optional)</Label>
          <Input
            id="reservePrice"
            type="number"
            min="0"
            step="0.01"
            value={formData.reservePrice}
            onChange={(e) => setFormData({ ...formData, reservePrice: e.target.value })}
          />
        </div>

        <div>
          <Label htmlFor="duration">Duration (Days)</Label>
          <Input
            id="duration"
            type="number"
            min="1"
            max="30"
            value={formData.duration}
            onChange={(e) => setFormData({ ...formData, duration: e.target.value })}
            required
          />
        </div>

        <Button type="submit" className="w-full">
          Create Auction
        </Button>
      </form>
    </Card>
  );
};