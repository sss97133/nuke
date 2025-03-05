
import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";

interface EditVehicleFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vehicleId: string;
  onSuccess?: () => void;
}

interface VehicleFormData {
  make: string;
  model: string;
  year: string;
  color: string;
  vin: string;
  licensePlate: string;
  mileage: string;
  ownership_status: string;
  purchaseDate: string;
  notes: string;
}

const EditVehicleForm: React.FC<EditVehicleFormProps> = ({
  open,
  onOpenChange,
  vehicleId,
  onSuccess
}) => {
  const [formData, setFormData] = useState<VehicleFormData>({
    make: '',
    model: '',
    year: '',
    color: '',
    vin: '',
    licensePlate: '',
    mileage: '',
    ownership_status: 'owned',
    purchaseDate: '',
    notes: ''
  });
  
  const [activeTab, setActiveTab] = useState('basic');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();
  
  // Load vehicle data
  useEffect(() => {
    if (open && vehicleId) {
      setIsLoading(true);
      
      // In a real application, you would fetch the vehicle data from your API
      // For this demo, we'll use mock data
      setTimeout(() => {
        // Mock data based on the vehicle ID
        const mockVehicle = {
          make: vehicleId === '1' ? 'Ford' : vehicleId === '2' ? 'Chevrolet' : 'Porsche',
          model: vehicleId === '1' ? 'Mustang' : vehicleId === '2' ? 'Corvette' : '911',
          year: vehicleId === '1' ? '1967' : vehicleId === '2' ? '1963' : '1973',
          color: vehicleId === '1' ? 'blue' : vehicleId === '2' ? 'red' : 'silver',
          vin: `SAMPLE${vehicleId}23456789`,
          licensePlate: `ABC${vehicleId}23`,
          mileage: vehicleId === '1' ? '78500' : vehicleId === '2' ? '120300' : '45200',
          ownership_status: vehicleId === '1' ? 'owned' : vehicleId === '2' ? 'claimed' : 'discovered',
          purchaseDate: '2024-01-15',
          notes: `Sample notes for vehicle ${vehicleId}.`
        };
        
        setFormData(mockVehicle);
        setIsLoading(false);
      }, 500);
    }
  }, [open, vehicleId]);
  
  // Form field handlers
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };
  
  const handleSelectChange = (name: string, value: string) => {
    setFormData(prev => ({ ...prev, [name]: value }));
  };
  
  // Form submission
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    // In a real app, you would submit the form data to your API
    // For demo purposes, we'll just show a success toast after a brief delay
    setTimeout(() => {
      toast({
        title: "Vehicle updated",
        description: `Your ${formData.year} ${formData.make} ${formData.model} has been updated.`,
        variant: "default"
      });
      
      setIsSubmitting(false);
      onOpenChange(false);
      
      if (onSuccess) {
        onSuccess();
      }
    }, 800);
  };
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[550px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Vehicle</DialogTitle>
          <DialogDescription>
            Update your vehicle information below.
          </DialogDescription>
        </DialogHeader>
        
        {isLoading ? (
          <div className="py-8 text-center">
            <p className="text-muted-foreground">Loading vehicle data...</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6 py-4">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="basic">Basic Info</TabsTrigger>
                <TabsTrigger value="details">Details</TabsTrigger>
              </TabsList>
              
              <TabsContent value="basic" className="space-y-4 pt-4">
                {/* Make, Model, Year */}
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="make">Make</Label>
                    <Input
                      id="make"
                      name="make"
                      value={formData.make}
                      onChange={handleChange}
                      placeholder="e.g., Ford"
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="model">Model</Label>
                    <Input
                      id="model"
                      name="model"
                      value={formData.model}
                      onChange={handleChange}
                      placeholder="e.g., Mustang"
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="year">Year</Label>
                    <Input
                      id="year"
                      name="year"
                      value={formData.year}
                      onChange={handleChange}
                      placeholder="e.g., 2020"
                    />
                  </div>
                </div>
                
                {/* Color and Mileage */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="color">Color</Label>
                    <Input
                      id="color"
                      name="color"
                      value={formData.color}
                      onChange={handleChange}
                      placeholder="e.g., Blue"
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="mileage">Mileage</Label>
                    <Input
                      id="mileage"
                      name="mileage"
                      value={formData.mileage}
                      onChange={handleChange}
                      placeholder="e.g., 50000"
                    />
                  </div>
                </div>
                
                {/* Ownership Status */}
                <div className="space-y-2">
                  <Label htmlFor="ownership_status">Ownership Status</Label>
                  <Select 
                    value={formData.ownership_status} 
                    onValueChange={(value) => handleSelectChange('ownership_status', value)}
                  >
                    <SelectTrigger id="ownership_status">
                      <SelectValue placeholder="Select status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="owned">Owned</SelectItem>
                      <SelectItem value="claimed">Claimed</SelectItem>
                      <SelectItem value="discovered">Discovered</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </TabsContent>
              
              <TabsContent value="details" className="space-y-4 pt-4">
                {/* VIN and License Plate */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="vin">VIN</Label>
                    <Input
                      id="vin"
                      name="vin"
                      value={formData.vin}
                      onChange={handleChange}
                      placeholder="Vehicle Identification Number"
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="licensePlate">License Plate</Label>
                    <Input
                      id="licensePlate"
                      name="licensePlate"
                      value={formData.licensePlate}
                      onChange={handleChange}
                      placeholder="License Plate Number"
                    />
                  </div>
                </div>
                
                {/* Purchase Date */}
                <div className="space-y-2">
                  <Label htmlFor="purchaseDate">Purchase Date</Label>
                  <Input
                    id="purchaseDate"
                    name="purchaseDate"
                    type="date"
                    value={formData.purchaseDate}
                    onChange={handleChange}
                  />
                </div>
                
                {/* Notes */}
                <div className="space-y-2">
                  <Label htmlFor="notes">Notes</Label>
                  <Textarea
                    id="notes"
                    name="notes"
                    value={formData.notes}
                    onChange={handleChange}
                    placeholder="Additional notes about your vehicle..."
                    className="min-h-[100px]"
                  />
                </div>
              </TabsContent>
            </Tabs>
            
            <DialogFooter>
              <Button 
                type="button" 
                variant="outline" 
                onClick={() => onOpenChange(false)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button 
                type="submit" 
                disabled={isSubmitting}
              >
                {isSubmitting ? "Saving Changes..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default EditVehicleForm;
