import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";

export const ServiceTicketForm = () => {
  const { toast } = useToast();
  const [formData, setFormData] = useState({
    vehicleId: "",
    description: "",
    status: "pending",
    priority: "medium",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const { error } = await supabase.from("service_tickets").insert([formData]);

      if (error) throw error;

      toast({
        title: "Service ticket created successfully",
      });

      setFormData({
        vehicleId: "",
        description: "",
        status: "pending",
        priority: "medium",
      });
    } catch (error) {
      console.error("Error creating service ticket:", error);
      toast({
        title: "Error creating service ticket",
        variant: "destructive",
      });
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 bg-white border border-gray-200 p-6">
      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-2">
          <Label htmlFor="vehicleId" className="font-mono text-sm">Vehicle ID *</Label>
          <Input
            id="vehicleId"
            value={formData.vehicleId}
            onChange={(e) => setFormData({ ...formData, vehicleId: e.target.value })}
            className="font-mono"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="priority" className="font-mono text-sm">Priority</Label>
          <Select
            value={formData.priority}
            onValueChange={(value) => setFormData({ ...formData, priority: value })}
          >
            <SelectTrigger className="font-mono">
              <SelectValue placeholder="Select priority" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="description" className="font-mono text-sm">Description *</Label>
        <Textarea
          id="description"
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          className="font-mono"
          required
        />
      </div>
      <Button
        type="submit"
        className="w-full bg-[#283845] hover:bg-[#1a2830] text-white font-mono text-sm"
      >
        Create Service Ticket
      </Button>
    </form>
  );
};