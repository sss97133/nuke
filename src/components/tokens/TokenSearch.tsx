
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, ArrowUpDown } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface TokenSearchProps {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  sortField: "name" | "symbol" | "total_supply" | "created_at";
  setSortField: (field: "name" | "symbol" | "total_supply" | "created_at") => void;
  sortDirection: "asc" | "desc";
  toggleSortDirection: () => void;
}

export const TokenSearch = ({ 
  searchQuery, 
  setSearchQuery, 
  sortField, 
  setSortField, 
  sortDirection, 
  toggleSortDirection 
}: TokenSearchProps) => {
  return (
    <Card className="p-4 mb-4">
      <div className="flex gap-2 items-center">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search tokens by name, symbol or address..."
            className="pl-8"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <Select value={sortField} onValueChange={(value: any) => setSortField(value)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name">Name</SelectItem>
            <SelectItem value="symbol">Symbol</SelectItem>
            <SelectItem value="total_supply">Total Supply</SelectItem>
            <SelectItem value="created_at">Created Date</SelectItem>
          </SelectContent>
        </Select>
        <Button 
          variant="outline" 
          size="icon" 
          onClick={toggleSortDirection} 
          title={`Sort ${sortDirection === "asc" ? "descending" : "ascending"}`}
        >
          <ArrowUpDown className="h-4 w-4" />
        </Button>
      </div>
    </Card>
  );
};
