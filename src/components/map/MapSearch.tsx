
import React from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface MapSearchProps {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  yearRange: string;
  setYearRange: (range: string) => void;
  isSearching: boolean;
  onSearch: () => void;
}

export const MapSearch = ({
  searchQuery,
  setSearchQuery,
  yearRange,
  setYearRange,
  isSearching,
  onSearch
}: MapSearchProps) => {
  return (
    <div className="flex items-center gap-4">
      <Input
        type="text"
        placeholder="Search for vehicles (e.g. mustang fastback)"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        className="flex-1"
      />
      <Input
        type="text"
        placeholder="Year range (e.g. 65-69)"
        value={yearRange}
        onChange={(e) => setYearRange(e.target.value)}
        className="w-32"
      />
      <Button 
        onClick={onSearch}
        disabled={isSearching}
      >
        {isSearching ? "Searching..." : "Search"}
      </Button>
    </div>
  );
};
