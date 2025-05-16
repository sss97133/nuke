
import React from 'react';
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DatePickerWithRange } from "./DatePickerWithRange";
import { DateRange } from "react-day-picker";

interface ServiceFiltersProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  sortOption: string;
  onSortChange: (value: string) => void;
  dateRange: DateRange | undefined;
  onDateRangeChange: (range: DateRange | undefined) => void;
}

const ServiceFilters = ({
  searchQuery,
  onSearchChange,
  sortOption,
  onSortChange,
  dateRange,
  onDateRangeChange
}: ServiceFiltersProps) => {
  return (
    <div className="space-y-4 mb-4 sm:mb-6">
      <div className="flex flex-col gap-3 sm:gap-4">
        <div className="relative w-full">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search service records..."
            className="pl-8"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="sortBy">Sort By</Label>
            <Select value={sortOption} onValueChange={onSortChange}>
              <SelectTrigger id="sortBy" className="w-full">
                <SelectValue placeholder="Select sort order" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="date-desc">Date (Newest First)</SelectItem>
                <SelectItem value="date-asc">Date (Oldest First)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <div className="space-y-1.5">
            <Label>Date Range</Label>
            <DatePickerWithRange 
              date={dateRange} 
              onDateChange={onDateRangeChange} 
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default ServiceFilters;
