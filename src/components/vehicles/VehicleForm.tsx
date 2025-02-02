import React from 'react';
import { useForm } from 'react-hook-form';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface VehicleFormProps {
  onSuccess?: () => void;
}

export const VehicleForm = ({ onSuccess }: VehicleFormProps = {}) => {
  const { register, handleSubmit, formState: { errors } } = useForm();
  const { toast } = useToast();

  const onSubmit = async (data: any) => {
    try {
      const { error } = await supabase
        .from('vehicles')
        .insert([
          {
            make: data.make,
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
        <Input id="make" {...register("make", { required: true })} />
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