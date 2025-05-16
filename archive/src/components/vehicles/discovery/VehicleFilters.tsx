
import React from 'react';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Filter, Grid, List, Table, SortAsc, SortDesc } from 'lucide-react';
import { SortDirection, SortField } from './types';

interface VehicleFiltersProps {
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  viewMode: string;
  setViewMode: (mode: string) => void;
  sortField: SortField;
  setSortField: (field: SortField) => void;
  sortDirection: SortDirection;
  setSortDirection: (direction: SortDirection) => void;
}

const VehicleFilters = ({ 
  searchTerm, 
  setSearchTerm, 
  viewMode, 
  setViewMode,
  sortField,
  setSortField,
  sortDirection,
  setSortDirection
}: VehicleFiltersProps) => {
  const handleSortChange = (value: string) => {
    const [field, direction] = value.split('-');
    setSortField(field as SortField);
    setSortDirection(direction as SortDirection);
  }

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
        <Select value={`${sortField}-${sortDirection}`} onValueChange={handleSortChange}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="added-desc">Newest First</SelectItem>
            <SelectItem value="added-asc">Oldest First</SelectItem>
            <SelectItem value="price-desc">Price: High to Low</SelectItem>
            <SelectItem value="price-asc">Price: Low to High</SelectItem>
            <SelectItem value="year-desc">Year: Newest</SelectItem>
            <SelectItem value="year-asc">Year: Oldest</SelectItem>
            <SelectItem value="make-asc">Make: A to Z</SelectItem>
            <SelectItem value="make-desc">Make: Z to A</SelectItem>
            <SelectItem value="mileage-asc">Mileage: Low to High</SelectItem>
            <SelectItem value="mileage-desc">Mileage: High to Low</SelectItem>
          </SelectContent>
        </Select>
        
        <Button variant="outline" className="gap-2">
          <Filter className="h-4 w-4" />
          Filters
        </Button>
        
        <div className="flex rounded-md border">
          <Button 
            variant={viewMode === "grid" ? "default" : "ghost"} 
            size="sm" 
            className="rounded-l-md rounded-r-none border-r"
            onClick={() => setViewMode("grid")}
          >
            <Grid className="h-4 w-4" />
          </Button>
          <Button 
            variant={viewMode === "list" ? "default" : "ghost"} 
            size="sm" 
            className="rounded-none border-r"
            onClick={() => setViewMode("list")}
          >
            <List className="h-4 w-4" />
          </Button>
          <Button 
            variant={viewMode === "table" ? "default" : "ghost"} 
            size="sm" 
            className="rounded-r-md rounded-l-none"
            onClick={() => setViewMode("table")}
          >
            <Table className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};

export default VehicleFilters;
