
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
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";

interface FilterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApplyFilters: (filters: any) => void;
}

const FilterDialog: React.FC<FilterDialogProps> = ({
  open,
  onOpenChange,
  onApplyFilters
}) => {
  const [priceRange, setPriceRange] = React.useState([0, 100000]);
  const [condition, setCondition] = React.useState<string>("");
  const [categories, setCategories] = React.useState<string[]>([]);
  const [distance, setDistance] = React.useState<number>(50);
  
  // Category options
  const categoryOptions = [
    { id: "cars", label: "Cars" },
    { id: "trucks", label: "Trucks" },
    { id: "motorcycles", label: "Motorcycles" },
    { id: "parts", label: "Parts" },
    { id: "accessories", label: "Accessories" }
  ];
  
  // Handle category selection
  const handleCategoryChange = (id: string, checked: boolean) => {
    if (checked) {
      setCategories([...categories, id]);
    } else {
      setCategories(categories.filter(cat => cat !== id));
    }
  };
  
  // Apply filters and close dialog
  const handleApplyFilters = () => {
    onApplyFilters({
      priceRange,
      condition,
      categories,
      distance
    });
    onOpenChange(false);
  };
  
  // Reset all filters
  const handleResetFilters = () => {
    setPriceRange([0, 100000]);
    setCondition("");
    setCategories([]);
    setDistance(50);
  };
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Filter Listings</DialogTitle>
        </DialogHeader>
        
        <div className="grid gap-4 py-4">
          {/* Price Range */}
          <div className="space-y-2">
            <Label>Price Range</Label>
            <div className="flex justify-between text-sm mb-1">
              <span>${priceRange[0].toLocaleString()}</span>
              <span>${priceRange[1].toLocaleString()}</span>
            </div>
            <Slider
              defaultValue={priceRange}
              max={100000}
              step={1000}
              onValueChange={setPriceRange}
              className="mt-2"
            />
          </div>
          
          {/* Condition */}
          <div className="space-y-2">
            <Label htmlFor="condition">Condition</Label>
            <Select value={condition} onValueChange={setCondition}>
              <SelectTrigger id="condition">
                <SelectValue placeholder="Any condition" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Any condition</SelectItem>
                <SelectItem value="new">New</SelectItem>
                <SelectItem value="like-new">Like New</SelectItem>
                <SelectItem value="excellent">Excellent</SelectItem>
                <SelectItem value="good">Good</SelectItem>
                <SelectItem value="fair">Fair</SelectItem>
                <SelectItem value="poor">Poor</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          {/* Categories */}
          <div className="space-y-2">
            <Label>Categories</Label>
            <div className="grid grid-cols-2 gap-2 mt-1">
              {categoryOptions.map((category) => (
                <div className="flex items-center space-x-2" key={category.id}>
                  <Checkbox 
                    id={`category-${category.id}`}
                    checked={categories.includes(category.id)}
                    onCheckedChange={(checked) => 
                      handleCategoryChange(category.id, checked === true)
                    }
                  />
                  <label 
                    htmlFor={`category-${category.id}`}
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    {category.label}
                  </label>
                </div>
              ))}
            </div>
          </div>
          
          {/* Distance */}
          <div className="space-y-2">
            <Label>Distance: {distance} miles</Label>
            <Slider
              defaultValue={[distance]}
              max={500}
              step={10}
              onValueChange={(value) => setDistance(value[0])}
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

export default FilterDialog;
