
import React from 'react';
import { 
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";

interface VehicleFilterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApplyFilters: (filters: VehicleFilters) => void;
}

export interface VehicleFilters {
  make?: string;
  model?: string;
  yearRange?: [number, number];
  colors?: string[];
  statuses?: string[];
  mileageRange?: [number, number];
}

const VehicleFilterDialog: React.FC<VehicleFilterDialogProps> = ({
  open,
  onOpenChange,
  onApplyFilters
}) => {
  const currentYear = new Date().getFullYear();
  
  // Initialize filter states
  const [make, setMake] = React.useState<string>("");
  const [model, setModel] = React.useState<string>("");
  const [yearRange, setYearRange] = React.useState<[number, number]>([1950, currentYear]);
  const [colors, setColors] = React.useState<string[]>([]);
  const [statuses, setStatuses] = React.useState<string[]>([]);
  const [mileageRange, setMileageRange] = React.useState<[number, number]>([0, 200000]);
  
  // Color options
  const colorOptions = [
    { id: "black", label: "Black" },
    { id: "white", label: "White" },
    { id: "silver", label: "Silver" },
    { id: "gray", label: "Gray" },
    { id: "red", label: "Red" },
    { id: "blue", label: "Blue" },
    { id: "green", label: "Green" },
    { id: "yellow", label: "Yellow" },
    { id: "other", label: "Other" }
  ];
  
  // Status options
  const statusOptions = [
    { id: "owned", label: "Owned" },
    { id: "claimed", label: "Claimed" },
    { id: "discovered", label: "Discovered" }
  ];
  
  // Handle checkbox selections
  const handleColorChange = (id: string, checked: boolean) => {
    if (checked) {
      setColors([...colors, id]);
    } else {
      setColors(colors.filter(color => color !== id));
    }
  };
  
  const handleStatusChange = (id: string, checked: boolean) => {
    if (checked) {
      setStatuses([...statuses, id]);
    } else {
      setStatuses(statuses.filter(status => status !== id));
    }
  };
  
  // Apply filters and close dialog
  const handleApplyFilters = () => {
    const filters: VehicleFilters = {};
    
    if (make) filters.make = make;
    if (model) filters.model = model;
    if (yearRange[0] !== 1950 || yearRange[1] !== currentYear) {
      filters.yearRange = yearRange;
    }
    if (colors.length > 0) filters.colors = colors;
    if (statuses.length > 0) filters.statuses = statuses;
    if (mileageRange[0] !== 0 || mileageRange[1] !== 200000) {
      filters.mileageRange = mileageRange;
    }
    
    onApplyFilters(filters);
    onOpenChange(false);
  };
  
  // Reset all filters
  const handleResetFilters = () => {
    setMake("");
    setModel("");
    setYearRange([1950, currentYear]);
    setColors([]);
    setStatuses([]);
    setMileageRange([0, 200000]);
  };
  
  // List of popular makes for the dropdown
  const popularMakes = [
    "Acura", "Alfa Romeo", "Aston Martin", "Audi", "Bentley", "BMW", "Bugatti",
    "Buick", "Cadillac", "Chevrolet", "Chrysler", "Citroën", "Dodge", "Ferrari",
    "Fiat", "Ford", "Genesis", "GMC", "Honda", "Hyundai", "Infiniti", "Jaguar",
    "Jeep", "Kia", "Lamborghini", "Land Rover", "Lexus", "Lincoln", "Lotus",
    "Maserati", "Mazda", "McLaren", "Mercedes-Benz", "Mini", "Mitsubishi",
    "Nissan", "Pagani", "Porsche", "Ram", "Rolls-Royce", "Subaru", "Tesla",
    "Toyota", "Volkswagen", "Volvo"
  ];
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Filter Vehicles</DialogTitle>
        </DialogHeader>
        
        <div className="grid gap-4 py-4">
          {/* Make and Model */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="make">Make</Label>
              <Select value={make} onValueChange={setMake}>
                <SelectTrigger id="make">
                  <SelectValue placeholder="Any make" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Any make</SelectItem>
                  {popularMakes.map(make => (
                    <SelectItem key={make} value={make.toLowerCase()}>
                      {make}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="model">Model</Label>
              <Input
                id="model"
                placeholder="Any model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              />
            </div>
          </div>
          
          {/* Year Range */}
          <div className="space-y-2">
            <Label>Year Range</Label>
            <div className="flex justify-between text-sm mb-1">
              <span>{yearRange[0]}</span>
              <span>{yearRange[1]}</span>
            </div>
            <Slider
              defaultValue={yearRange}
              min={1950}
              max={currentYear}
              step={1}
              onValueChange={setYearRange}
              className="mt-2"
            />
          </div>
          
          {/* Colors */}
          <div className="space-y-2">
            <Label>Colors</Label>
            <div className="grid grid-cols-3 gap-2 mt-1">
              {colorOptions.map((color) => (
                <div className="flex items-center space-x-2" key={color.id}>
                  <Checkbox 
                    id={`color-${color.id}`}
                    checked={colors.includes(color.id)}
                    onCheckedChange={(checked) => 
                      handleColorChange(color.id, checked === true)
                    }
                  />
                  <label 
                    htmlFor={`color-${color.id}`}
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    {color.label}
                  </label>
                </div>
              ))}
            </div>
          </div>
          
          {/* Status */}
          <div className="space-y-2">
            <Label>Ownership Status</Label>
            <div className="grid grid-cols-3 gap-2 mt-1">
              {statusOptions.map((status) => (
                <div className="flex items-center space-x-2" key={status.id}>
                  <Checkbox 
                    id={`status-${status.id}`}
                    checked={statuses.includes(status.id)}
                    onCheckedChange={(checked) => 
                      handleStatusChange(status.id, checked === true)
                    }
                  />
                  <label 
                    htmlFor={`status-${status.id}`}
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    {status.label}
                  </label>
                </div>
              ))}
            </div>
          </div>
          
          {/* Mileage Range */}
          <div className="space-y-2">
            <Label>Mileage Range</Label>
            <div className="flex justify-between text-sm mb-1">
              <span>{mileageRange[0].toLocaleString()} mi</span>
              <span>{mileageRange[1].toLocaleString()} mi</span>
            </div>
            <Slider
              defaultValue={mileageRange}
              min={0}
              max={200000}
              step={5000}
              onValueChange={setMileageRange}
              className="mt-2"
            />
          </div>
        </div>
        
        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleResetFilters}
          >
            Reset
          </Button>
          <DialogClose asChild>
            <Button type="button" variant="ghost">Cancel</Button>
          </DialogClose>
          <Button type="button" onClick={handleApplyFilters}>
            Apply Filters
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default VehicleFilterDialog;
