import type { Database } from '../types';
import React from 'react';
import { useForm } from 'react-hook-form';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Check, ChevronsUpDown } from "lucide-react"
import { cn } from "@/lib/utils";
import { useState } from "react";

const carBrands = [
  "Acura", "Alfa Romeo", "Aston Martin", "Audi", "Bentley", "BMW", "Bugatti",
  "Buick", "Cadillac", "Chevrolet", "Chrysler", "Citroën", "Dodge", "Ferrari",
  "Fiat", "Ford", "Genesis", "GMC", "Honda", "Hyundai", "Infiniti", "Jaguar",
  "Jeep", "Kia", "Lamborghini", "Land Rover", "Lexus", "Lincoln", "Lotus",
  "Maserati", "Mazda", "McLaren", "Mercedes-Benz", "Mini", "Mitsubishi",
  "Nissan", "Pagani", "Peugeot", "Porsche", "Ram", "Renault", "Rolls-Royce",
  "Subaru", "Tesla", "Toyota", "Volkswagen", "Volvo"
];

interface VehicleFormProps {
  onSuccess?: () => void;
}

interface VehicleFormData {
  make: string;
  model: string;
  year: string;
  vin?: string;
  notes?: string;
}

export const VehicleForm = ({ onSuccess }: VehicleFormProps = {}) => {
  const { register, handleSubmit, formState: { errors } } = useForm<VehicleFormData>();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [selectedBrand, setSelectedBrand] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const filteredBrands = carBrands.filter(brand => 
    brand.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const onSubmit = async (data: VehicleFormData) => {
    try {
      const { error } = await supabase
        .from('vehicles')
        .insert([
          {
            make: selectedBrand || data.make,
            model: data.model,
            year: parseInt(data.year),
            vin: data.vin,
            notes: data.notes,
            user_id: (await supabase.auth.getUser()).data.user?.id
          }
        ]);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Vehicle added successfully",
      });

      onSuccess?.();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to add vehicle",
        variant: "destructive",
      });
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <Label htmlFor="make">Make</Label>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className="w-full justify-between"
            >
              {selectedBrand || "Select brand..."}
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-full p-0">
            <Command>
              <CommandInput 
                placeholder="Search brand..." 
                value={searchQuery}
                onValueChange={setSearchQuery}
              />
              <CommandEmpty>No brand found.</CommandEmpty>
              <CommandGroup className="max-h-[200px] overflow-y-auto">
                {filteredBrands.map((brand) => (
                  <CommandItem
                    key={brand}
                    value={brand}
                    onSelect={() => {
                      setSelectedBrand(brand === selectedBrand ? "" : brand);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        selectedBrand === brand ? "opacity-100" : "opacity-0"
                      )}
                    />
                    {brand}
                  </CommandItem>
                ))}
              </CommandGroup>
            </Command>
          </PopoverContent>
        </Popover>
        {errors.make && <span className="text-red-500">This field is required</span>}
      </div>

      <div>
        <Label htmlFor="model">Model</Label>
        <Input id="model" {...register("model", { required: true })} />
        {errors.model && <span className="text-red-500">This field is required</span>}
      </div>

      <div>
        <Label htmlFor="year">Year</Label>
        <Input 
          id="year" 
          type="number" 
          {...register("year", { 
            required: true,
            min: 1900,
            max: new Date().getFullYear() + 1
          })} 
        />
        {errors.year && <span className="text-red-500">Please enter a valid year</span>}
      </div>

      <div>
        <Label htmlFor="vin">VIN (Optional)</Label>
        <Input id="vin" {...register("vin")} />
      </div>

      <div>
        <Label htmlFor="notes">Notes (Optional)</Label>
        <Input id="notes" {...register("notes")} />
      </div>

      <Button type="submit" className="w-full">Add Vehicle</Button>
    </form>
  );
};