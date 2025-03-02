
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface FuelEntryFormProps {
  onEntryAdded: () => void;
}

export const FuelEntryForm = ({ onEntryAdded }: FuelEntryFormProps) => {
  const { toast } = useToast();
  const [date, setDate] = useState<Date>(new Date());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    vehicleId: "",
    amount: "",
    price: "",
    odometer: "",
    fuelType: "regular",
    notes: ""
  });

  const [vehicles, setVehicles] = useState<Array<{ id: string; make: string; model: string; year: number }>>([]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSelectChange = (name: string, value: string) => {
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      // In a real implementation, this would save to Supabase
      // const { error } = await supabase.from('fuel_entries').insert([{
      //   vehicle_id: formData.vehicleId,
      //   amount: parseFloat(formData.amount),
      //   price_per_unit: parseFloat(formData.price),
      //   odometer: parseInt(formData.odometer),
      //   fuel_type: formData.fuelType,
      //   notes: formData.notes,
      //   date: date.toISOString()
      // }]);
      
      // if (error) throw error;

      // For now, we'll just simulate success
      toast({
        title: "Fuel entry added",
        description: "Your fuel entry has been successfully recorded.",
      });

      // Reset form
      setFormData({
        vehicleId: "",
        amount: "",
        price: "",
        odometer: "",
        fuelType: "regular",
        notes: ""
      });
      setDate(new Date());
      
      // Notify parent that an entry was added
      onEntryAdded();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to save fuel entry",
        variant: "destructive"
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="vehicleId">Vehicle</Label>
        <Select 
          value={formData.vehicleId}
          onValueChange={(value) => handleSelectChange("vehicleId", value)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select a vehicle" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="placeholder">Select a vehicle first</SelectItem>
          </SelectContent>
        </Select>
      </div>
      
      <div className="space-y-2">
        <Label htmlFor="date">Date</Label>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={cn(
                "w-full justify-start text-left font-normal",
                !date && "text-muted-foreground"
              )}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              {date ? format(date, "PPP") : "Select a date"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0">
            <Calendar
              mode="single"
              selected={date}
              onSelect={(date) => date && setDate(date)}
              initialFocus
            />
          </PopoverContent>
        </Popover>
      </div>
      
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="amount">Amount (gallons)</Label>
          <Input
            id="amount"
            name="amount"
            type="number"
            step="0.001"
            value={formData.amount}
            onChange={handleInputChange}
            required
          />
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="price">Price per gallon ($)</Label>
          <Input
            id="price"
            name="price"
            type="number"
            step="0.01"
            value={formData.price}
            onChange={handleInputChange}
            required
          />
        </div>
      </div>
      
      <div className="space-y-2">
        <Label htmlFor="odometer">Odometer Reading</Label>
        <Input
          id="odometer"
          name="odometer"
          type="number"
          value={formData.odometer}
          onChange={handleInputChange}
          required
        />
      </div>
      
      <div className="space-y-2">
        <Label htmlFor="fuelType">Fuel Type</Label>
        <Select 
          value={formData.fuelType}
          onValueChange={(value) => handleSelectChange("fuelType", value)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select fuel type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="regular">Regular</SelectItem>
            <SelectItem value="premium">Premium</SelectItem>
            <SelectItem value="diesel">Diesel</SelectItem>
            <SelectItem value="electric">Electric</SelectItem>
          </SelectContent>
        </Select>
      </div>
      
      <div className="space-y-2">
        <Label htmlFor="notes">Notes</Label>
        <Input
          id="notes"
          name="notes"
          value={formData.notes}
          onChange={handleInputChange}
        />
      </div>
      
      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? "Saving..." : "Add Fuel Entry"}
      </Button>
    </form>
  );
};
