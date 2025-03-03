
import React from 'react';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Filter } from 'lucide-react';

interface VehicleFiltersProps {
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  viewMode: string;
  setViewMode: (mode: string) => void;
}

const VehicleFilters = ({ searchTerm, setSearchTerm, viewMode, setViewMode }: VehicleFiltersProps) => {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-center">
      <div className="flex-1 relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input 
          placeholder="Search vehicles..." 
          className="pl-9" 
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>
      
      <div className="flex gap-2 flex-wrap">
        <Select defaultValue="newest">
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">Newest First</SelectItem>
            <SelectItem value="oldest">Oldest First</SelectItem>
            <SelectItem value="price-high">Price: High to Low</SelectItem>
            <SelectItem value="price-low">Price: Low to High</SelectItem>
          </SelectContent>
        </Select>
        
        <Button variant="outline" className="gap-2">
          <Filter className="h-4 w-4" />
          Filters
        </Button>
        
        <Select value={viewMode} onValueChange={setViewMode}>
          <SelectTrigger className="w-[130px]">
            <SelectValue placeholder="View mode" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="grid">Grid View</SelectItem>
            <SelectItem value="table">Table View</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
};

export default VehicleFilters;
