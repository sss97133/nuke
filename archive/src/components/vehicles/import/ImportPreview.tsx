import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import type { Vehicle } from "@/types/inventory";
import { Loader2 } from "lucide-react";
import { checkQueryError } from "@/utils/supabase-helpers";

interface ImportPreviewProps {
  vehicles: Vehicle[];
  onBack: () => void;
  onComplete: () => void;
}

export const ImportPreview = ({ vehicles, onBack, onComplete }: ImportPreviewProps) => {
  const [editedVehicles, setEditedVehicles] = useState(vehicles);
  const [isImporting, setIsImporting] = useState(false);
  const { toast } = useToast();

  const handleVehicleChange = (
    index: number, 
    field: keyof Vehicle, 
    value: Vehicle[keyof Vehicle]
  ) => {
    const updated = [...editedVehicles];
    updated[index] = { ...updated[index], [field]: value };
    setEditedVehicles(updated);
  };

  const handleImport = async () => {
    setIsImporting(true);
    try {
      const { data: { user }, error } = await supabase.auth.getUser();
      
      checkQueryError(error);
      
      const vehiclesToInsert = editedVehicles.map(vehicle => ({
        make: vehicle.make,
        model: vehicle.model,
        year: vehicle.year,
        vin: vehicle.vin,
        notes: vehicle.notes,
        user_id: user?.id,
        historical_data: vehicle.historical_data ? JSON.stringify(vehicle.historical_data) : null
      }));

      const { error: insertError } = await supabase
        .from('vehicles')
        .insert(vehiclesToInsert);

      checkQueryError(insertError);

      toast({
        title: "Success",
        description: `Imported ${editedVehicles.length} vehicles successfully.`
      });
      
      onComplete();
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      toast({
        title: "Import Error",
        description: errorMessage,
        variant: "destructive"
      });
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-sm text-muted-foreground">
        Review and edit the imported vehicles before saving
      </div>

      <div className="max-h-[400px] overflow-y-auto space-y-4">
        {editedVehicles.map((vehicle, index) => (
          <div key={index} className="p-4 border rounded-lg space-y-2">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="text-xs">Make</label>
                <Input
                  value={vehicle.make}
                  onChange={(e) => handleVehicleChange(index, 'make', e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs">Model</label>
                <Input
                  value={vehicle.model}
                  onChange={(e) => handleVehicleChange(index, 'model', e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs">Year</label>
                <Input
                  type="number"
                  value={vehicle.year}
                  onChange={(e) => handleVehicleChange(index, 'year', parseInt(e.target.value))}
                />
              </div>
            </div>
            
            <div>
              <label className="text-xs">VIN (Optional)</label>
              <Input
                value={vehicle.vin || ''}
                onChange={(e) => handleVehicleChange(index, 'vin', e.target.value)}
              />
            </div>
            
            <div>
              <label className="text-xs">Notes (Optional)</label>
              <Textarea
                value={vehicle.notes || ''}
                onChange={(e) => handleVehicleChange(index, 'notes', e.target.value)}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        
        <Button 
          onClick={handleImport}
          disabled={isImporting}
        >
          {isImporting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
          Import {editedVehicles.length} Vehicles
        </Button>
      </div>
    </div>
  );
};
